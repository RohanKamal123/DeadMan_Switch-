// The private-release delivery engine (PRODUCT_SPEC.md §7 / §PRIVATE_RELEASE;
// DECISIONS.md 4.2 / 5.1 / 10.3 / 11.4; invariant 6).
//
// Channel separation is structural: the email carries ONLY a gated link, the
// SMS carries ONLY the one-time code, and content appears only after both are
// presented at the gated page. Recipients are delivered in strict user order
// with a 14-day silence fallback; a self-dealing recipient is skipped; access
// is logged (metadata only) and admin-revocable.

import { AuditLog } from '../../src/domain/audit';
import type { Confirmation } from '../../src/domain/quorum';
import {
  ReleaseController,
  ReleaseNotReadyError,
  type ReleaseRecipient,
} from '../../src/delivery/release';
import type { RecipientAccessPolicy } from '../../src/delivery/access-policy';
import { CODE_EXPIRY_HOURS, HOUR_MS, RECIPIENT_FALLBACK_DAYS, DAY_MS } from '../../src/domain/config';

const RELEASED_AT = 1_700_000_000_000;

function conf(contactId: string, group: Confirmation['group']): Confirmation {
  return { contactId, group, recordingOperatorId: 'op-1', at: RELEASED_AT - DAY_MS };
}

const QUORUM: Confirmation[] = [conf('a', 'family'), conf('b', 'friend'), conf('c', 'colleague')];

function recipient(id: string, over: Partial<ReleaseRecipient> = {}): ReleaseRecipient {
  return {
    recipientId: id,
    email: `${id}@x.example`,
    phone: `+8801${id}`,
    payloadIds: [`payload-${id}`],
    ...over,
  };
}

/** Deterministic code/link generators so tests can assert exact values. */
function sequences() {
  let codeN = 0;
  let linkN = 0;
  return {
    codeGenerator: () => `CODE${++codeN}`,
    linkGenerator: () => `link-${++linkN}`,
  };
}

function controller(opts: {
  recipients: ReleaseRecipient[];
  confirmations?: Confirmation[];
  state?: 'PRIVATE_RELEASE' | 'HOLD';
  audit?: AuditLog;
  accessPolicy?: RecipientAccessPolicy;
}) {
  const gen = sequences();
  return new ReleaseController({
    state: opts.state ?? 'PRIVATE_RELEASE',
    privateReleasedAt: RELEASED_AT,
    recipients: opts.recipients,
    confirmations: opts.confirmations ?? QUORUM,
    audit: opts.audit ?? new AuditLog(),
    codeGenerator: gen.codeGenerator,
    linkGenerator: gen.linkGenerator,
    ...(opts.accessPolicy !== undefined ? { accessPolicy: opts.accessPolicy } : {}),
  });
}

describe('ReleaseController — preconditions', () => {
  it('refuses to begin unless the machine is in PRIVATE_RELEASE', () => {
    const c = controller({ recipients: [recipient('r1')], state: 'HOLD' });
    expect(() => c.begin(RELEASED_AT)).toThrow(ReleaseNotReadyError);
  });
});

describe('ReleaseController — channel separation (invariant 6)', () => {
  it('emits a gated-link email and a code SMS on separate channels', () => {
    const c = controller({ recipients: [recipient('r1')] });
    const step = c.begin(RELEASED_AT);

    const email = step.messages.find((m) => m.channel === 'email');
    const sms = step.messages.find((m) => m.channel === 'sms');
    expect(email).toBeDefined();
    expect(sms).toBeDefined();

    // Email carries a link and NOTHING that could leak content or the code.
    expect(Object.keys(email!)).toEqual(expect.arrayContaining(['channel', 'to', 'gatedLink']));
    expect(Object.keys(email!)).not.toContain('code');
    expect(Object.keys(email!)).not.toContain('content');

    // SMS carries the code and NOTHING that could leak a link or content.
    expect(Object.keys(sms!)).toEqual(expect.arrayContaining(['channel', 'to', 'code']));
    expect(Object.keys(sms!)).not.toContain('gatedLink');
    expect(Object.keys(sms!)).not.toContain('link');
    expect(Object.keys(sms!)).not.toContain('content');
  });
});

describe('ReleaseController — gated authentication', () => {
  it('reveals content only when link and code are both presented within 72h', () => {
    const audit = new AuditLog();
    const c = controller({ recipients: [recipient('r1')], audit });
    c.begin(RELEASED_AT);

    const wrong = c.authenticate('link-1', 'NOPE', RELEASED_AT + HOUR_MS);
    expect(wrong.ok).toBe(false);

    const ok = c.authenticate('link-1', 'CODE1', RELEASED_AT + HOUR_MS);
    expect(ok.ok).toBe(true);
    if (!ok.ok) return;
    expect(ok.payloadIds).toEqual(['payload-r1']);

    // Access is logged as metadata only — no code, link, or content.
    const access = audit.all().find((e) => e.event === 'RELEASE_ACCESS');
    expect(access).toBeDefined();
    const values = Object.values(access!.metadata).join(' ');
    expect(values).not.toMatch(/CODE1|link-1|payload/);
  });

  it('rejects an expired code', () => {
    const c = controller({ recipients: [recipient('r1')] });
    c.begin(RELEASED_AT);
    const r = c.authenticate('link-1', 'CODE1', RELEASED_AT + CODE_EXPIRY_HOURS * HOUR_MS + 1);
    expect(r.ok).toBe(false);
  });

  it('re-issues a fresh code and invalidates the old one', () => {
    const c = controller({ recipients: [recipient('r1')] });
    c.begin(RELEASED_AT);
    const re = c.reissueCode('r1', RELEASED_AT + DAY_MS);
    expect(re.ok).toBe(true);
    if (!re.ok) return;
    expect(re.sms.code).toBe('CODE2');
    // Old code no longer works; new one does.
    expect(c.authenticate('link-1', 'CODE1', RELEASED_AT + DAY_MS).ok).toBe(false);
    expect(c.authenticate('link-1', 'CODE2', RELEASED_AT + DAY_MS).ok).toBe(true);
  });

  it('refuses to re-issue outside the 30-day retention window (5.1)', () => {
    const c = controller({ recipients: [recipient('r1')] });
    c.begin(RELEASED_AT);
    const re = c.reissueCode('r1', RELEASED_AT + 31 * DAY_MS);
    expect(re.ok).toBe(false);
  });

  it('rejects access after an admin revocation', () => {
    const c = controller({ recipients: [recipient('r1')] });
    c.begin(RELEASED_AT);
    c.revoke('r1', 'admin-1', RELEASED_AT + HOUR_MS);
    expect(c.authenticate('link-1', 'CODE1', RELEASED_AT + 2 * HOUR_MS).ok).toBe(false);
  });
});

describe('ReleaseController — recipient-access policy (F4.1)', () => {
  const POLICY: RecipientAccessPolicy = { maxCodeAttempts: 3, maxReissues: 2 };

  it('caps failed code attempts and then refuses even the correct code until re-issue', () => {
    const audit = new AuditLog();
    const c = controller({ recipients: [recipient('r1')], audit, accessPolicy: POLICY });
    c.begin(RELEASED_AT);
    const at = RELEASED_AT + HOUR_MS;

    // Three wrong attempts exhaust the per-code budget.
    for (let i = 0; i < 3; i++) {
      expect(c.authenticate('link-1', 'WRONG', at).ok).toBe(false);
    }
    // The correct code is now refused — the code is dead, a re-issue is required.
    const capped = c.authenticate('link-1', 'CODE1', at);
    expect(capped.ok).toBe(false);
    if (capped.ok) return;
    expect(capped.reason).toMatch(/too many attempts/i);

    // Each failure is logged as metadata only (no code/link/content).
    const fails = audit.all().filter((e) => e.event === 'RELEASE_ACCESS_FAIL');
    expect(fails.length).toBe(3);
    expect(Object.values(fails[0]!.metadata).join(' ')).not.toMatch(/CODE1|link-1|WRONG/);
  });

  it('a re-issue resets the attempt budget and the fresh code unlocks', () => {
    const c = controller({ recipients: [recipient('r1')], accessPolicy: POLICY });
    c.begin(RELEASED_AT);
    const at = RELEASED_AT + HOUR_MS;
    for (let i = 0; i < 3; i++) c.authenticate('link-1', 'WRONG', at);

    const re = c.reissueCode('r1', at);
    expect(re.ok).toBe(true);
    if (!re.ok) return;
    // Fresh code (CODE2) authenticates; the attempt cap no longer bites.
    expect(c.authenticate('link-1', re.sms.code, at).ok).toBe(true);
  });

  it('throttles re-issues to the configured maximum', () => {
    const c = controller({ recipients: [recipient('r1')], accessPolicy: POLICY });
    c.begin(RELEASED_AT);
    const at = RELEASED_AT + HOUR_MS;
    expect(c.reissueCode('r1', at).ok).toBe(true); // 1
    expect(c.reissueCode('r1', at).ok).toBe(true); // 2
    const third = c.reissueCode('r1', at); // over the cap of 2
    expect(third.ok).toBe(false);
    if (third.ok) return;
    expect(third.reason).toMatch(/re-issue limit/i);
  });

  it('imposes no cap when no policy is configured (numbers are deployment config, never invented)', () => {
    const c = controller({ recipients: [recipient('r1')] });
    c.begin(RELEASED_AT);
    const at = RELEASED_AT + HOUR_MS;
    for (let i = 0; i < 10; i++) expect(c.authenticate('link-1', 'WRONG', at).ok).toBe(false);
    // Correct code still works — no invented lockout.
    expect(c.authenticate('link-1', 'CODE1', at).ok).toBe(true);
  });
});

describe('ReleaseController — ordering, self-dealing, and fallback', () => {
  it('skips a self-dealing recipient and activates the next in order', () => {
    // 'c' is both a confirmer (colleague) and the first recipient; excluding
    // c's own confirmation drops quorum below three groups, so c is skipped.
    const c = controller({
      recipients: [recipient('c'), recipient('r2')],
      confirmations: QUORUM,
    });
    const step = c.begin(RELEASED_AT);
    const records = c.records();
    expect(records.find((r) => r.recipientId === 'c')?.status).toBe('skipped-self-dealing');
    expect(records.find((r) => r.recipientId === 'r2')?.status).toBe('active');
    // The emitted messages address r2, not c.
    expect(step.messages.every((m) => m.to.includes('r2'))).toBe(true);
  });

  it('does not advance to the next recipient before 14 days of silence', () => {
    const c = controller({ recipients: [recipient('r1'), recipient('r2')] });
    c.begin(RELEASED_AT);
    const step = c.advanceIfSilent(RELEASED_AT + (RECIPIENT_FALLBACK_DAYS - 1) * DAY_MS);
    expect(step.messages).toHaveLength(0);
    expect(c.records().find((r) => r.recipientId === 'r2')?.status).toBe('pending');
  });

  it('advances to the next recipient after 14 days of silence', () => {
    const c = controller({ recipients: [recipient('r1'), recipient('r2')] });
    c.begin(RELEASED_AT);
    const step = c.advanceIfSilent(RELEASED_AT + RECIPIENT_FALLBACK_DAYS * DAY_MS);
    expect(step.messages.length).toBeGreaterThan(0);
    expect(c.records().find((r) => r.recipientId === 'r2')?.status).toBe('active');
  });

  it('stops advancing once the active recipient has accessed their content', () => {
    const c = controller({ recipients: [recipient('r1'), recipient('r2')] });
    c.begin(RELEASED_AT);
    expect(c.authenticate('link-1', 'CODE1', RELEASED_AT + HOUR_MS).ok).toBe(true);
    const step = c.advanceIfSilent(RELEASED_AT + RECIPIENT_FALLBACK_DAYS * DAY_MS);
    expect(step.messages).toHaveLength(0);
    expect(c.records().find((r) => r.recipientId === 'r2')?.status).toBe('pending');
  });
});
