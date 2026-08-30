// The OperatorConsole wires operator actions to state-machine events while
// enforcing the structural guardrails of UX_SPEC.md §3:
//   - a confirmation's GROUP is derived from the enrolled roster, never typed
//     by the operator, so group diversity (invariant 4) cannot be faked;
//   - only a consented, non-stale confirmer's confirmation can be recorded
//     (DECISIONS.md 1.3 / 4.3);
//   - every view, note, and entry is audited as metadata only (invariant 7);
//   - self-dealing eligibility is surfaced per recipient (DECISIONS.md 10.3).

import { verifyingConsole, standardRoster, AT_CONFIRM } from './support';
import { OperatorConsole } from '../../src/console/console';
import { Machine } from '../../src/domain/machine';
import { T0, daysAfter } from '../support/factory';

describe('OperatorConsole — recording confirmations', () => {
  it('derives the group from the roster; the operator cannot supply one', () => {
    const c = verifyingConsole();
    const r = c.recordConfirmation('c-fam', 'op-1', AT_CONFIRM);
    expect(r.ok).toBe(true);
    // The recorded confirmation carries the roster group, not an operator input.
    const recorded = c.machine.context.confirmations.find((x) => x.contactId === 'c-fam');
    expect(recorded?.group).toBe('family');
  });

  it('refuses a confirmation from a consent-pending contact', () => {
    const c = verifyingConsole();
    const r = c.recordConfirmation('c-pending', 'op-1', AT_CONFIRM);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toMatch(/consent/i);
    expect(c.machine.context.confirmations).toHaveLength(0);
  });

  it('refuses a confirmation from a stale contact until re-verified', () => {
    const c = verifyingConsole();
    const blocked = c.recordConfirmation('c-stale', 'op-1', AT_CONFIRM);
    expect(blocked.ok).toBe(false);
    if (blocked.ok) return;
    expect(blocked.reason).toMatch(/stale|re-?verif/i);

    // Admin-assisted re-verification updates details only (DECISIONS.md 4.3),
    // then the confirmation can count.
    const rv = c.reVerifyContact('c-stale', 'admin-1', AT_CONFIRM, { email: 'gita-new@x.example' });
    expect(rv.ok).toBe(true);
    const ok = c.recordConfirmation('c-stale', 'op-1', AT_CONFIRM);
    expect(ok.ok).toBe(true);
  });

  it('refuses a confirmation from a recipient-only (non-confirmer) contact', () => {
    const c = verifyingConsole();
    const r = c.recordConfirmation('r-1', 'op-1', AT_CONFIRM);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toMatch(/confirmer/i);
  });

  it('refuses a confirmation for an unknown contact id', () => {
    const c = verifyingConsole();
    const r = c.recordConfirmation('nope', 'op-1', AT_CONFIRM);
    expect(r.ok).toBe(false);
  });
});

describe('OperatorConsole — quorum, hold, and self-dealing', () => {
  function withThreeGroups(c: OperatorConsole): void {
    c.recordConfirmation('c-fam', 'op-1', AT_CONFIRM);
    c.recordConfirmation('c-fri', 'op-1', AT_CONFIRM);
    c.recordConfirmation('c-col', 'op-1', AT_CONFIRM);
  }

  it('start HOLD is blocked until three distinct groups are recorded, and explains why', () => {
    const c = verifyingConsole();
    c.recordConfirmation('c-fam', 'op-1', AT_CONFIRM);
    c.recordConfirmation('c-fri', 'op-1', AT_CONFIRM);
    expect(c.holdReadiness().canStart).toBe(false);
    const blocked = c.startHold('op-1', AT_CONFIRM);
    expect(blocked.ok).toBe(false);

    c.recordConfirmation('c-col', 'op-1', AT_CONFIRM);
    expect(c.holdReadiness().canStart).toBe(true);
    const started = c.startHold('op-1', AT_CONFIRM);
    expect(started.ok).toBe(true);
    expect(c.state).toBe('HOLD');
  });

  it('surfaces self-dealing: a confirmer-recipient is not deliverable to themselves', () => {
    const c = verifyingConsole();
    c.recordConfirmation('c-fam', 'op-1', AT_CONFIRM);
    c.recordConfirmation('c-fri', 'op-1', AT_CONFIRM);
    c.recordConfirmation('c-both', 'op-1', AT_CONFIRM); // group 'other', also a recipient
    expect(c.quorumMeter().met).toBe(true);
    expect(c.recipientEligibility('c-both').deliverable).toBe(false);
    expect(c.recipientEligibility('r-1').deliverable).toBe(true);
  });

  it('drives the full path to PRIVATE_RELEASE through the console', () => {
    const c = verifyingConsole();
    withThreeGroups(c);
    expect(c.startHold('op-1', AT_CONFIRM).ok).toBe(true);
    // Before the window elapses, release is refused.
    expect(c.triggerPrivateRelease('op-1', daysAfter(T0, 40)).ok).toBe(false);
    // At the full lenient window, it succeeds.
    const rel = c.triggerPrivateRelease('op-1', daysAfter(T0, 61));
    expect(rel.ok).toBe(true);
    expect(c.state).toBe('PRIVATE_RELEASE');
  });

  it('a HOLD withdrawal that drops below quorum reopens VERIFYING', () => {
    const c = verifyingConsole();
    withThreeGroups(c);
    c.startHold('op-1', AT_CONFIRM);
    expect(c.state).toBe('HOLD');
    const w = c.recordWithdrawal('c-col', 'op-1', daysAfter(T0, 35));
    expect(w.ok).toBe(true);
    expect(c.state).toBe('VERIFYING');
  });
});

describe('OperatorConsole — auditing (invariant 7)', () => {
  it('logs a contact view as metadata only (no name/content)', () => {
    const c = verifyingConsole();
    c.viewContact('c-fam', 'op-1', AT_CONFIRM);
    const entries = c.machine.audit.all();
    const view = entries.find((e) => e.event === 'VIEW_CONTACT');
    expect(view).toBeDefined();
    expect(view?.actor).toBe('op-1');
    // No contact name or free text anywhere in the metadata values.
    const values = Object.values(view!.metadata).join(' ');
    expect(values).not.toMatch(/Ama/);
  });

  it('records a note without writing the note text into the audit log', () => {
    const c = verifyingConsole();
    c.recordNote('c-fam', 'Spoke to the family; no answer yet.', 'op-1', AT_CONFIRM);
    for (const e of c.machine.audit.all()) {
      const values = Object.values(e.metadata).join(' ');
      expect(values).not.toMatch(/Spoke to the family/);
    }
    // The note text lives in the operational case file, not the trail.
    expect(c.caseFor('c-fam').notes.some((n) => /Spoke to the family/.test(n.text))).toBe(true);
  });

  it('records a per-contact state tag and an overall state tag', () => {
    const c = verifyingConsole();
    expect(c.recordContactState('c-fam', 'deceased', 'op-1', AT_CONFIRM).ok).toBe(true);
    expect(c.recordOverallState('unknown', 'op-1', AT_CONFIRM).ok).toBe(true);
    expect(c.caseFor('c-fam').state).toBe('deceased');
    expect(c.overallState()).toBe('unknown');
  });

  it('every audited entry passes the metadata-safety guard', () => {
    const c = verifyingConsole();
    c.viewContact('c-fam', 'op-1', AT_CONFIRM);
    c.recordConfirmation('c-fam', 'op-1', AT_CONFIRM);
    c.recordContactState('c-fri', 'accident', 'op-1', AT_CONFIRM);
    // If any entry carried content/URL/code, append() would already have thrown.
    expect(c.machine.audit.length).toBeGreaterThan(0);
  });
});

describe('OperatorConsole — construction', () => {
  it('rejects recording before VERIFYING (nothing to verify yet)', () => {
    const c = new OperatorConsole({ machine: new Machine({ now: T0 }), contacts: standardRoster() });
    const r = c.recordConfirmation('c-fam', 'op-1', AT_CONFIRM);
    expect(r.ok).toBe(false);
  });
});
