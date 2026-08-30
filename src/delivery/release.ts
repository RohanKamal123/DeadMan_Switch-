// The private-release delivery engine (PRODUCT_SPEC.md §7 / §PRIVATE_RELEASE;
// DECISIONS.md 4.2 / 5.1 / 10.3 / 11.4).
//
// Preconditions are enforced upstream by the state machine: this controller
// only ever runs once the account is in PRIVATE_RELEASE (the HOLD window has
// fully elapsed with no cancel). It then:
//   - delivers to recipients in strict user order, no randomisation (§7);
//   - skips a recipient whose own confirmation was needed for quorum
//     (self-dealing guard, 10.3);
//   - issues an email (gated link) + SMS (one-time code) on separate channels
//     (invariant 6); content is revealed only at the gated page after both;
//   - falls back to the next recipient after 14 days of silence (11.4);
//   - re-issues an expired code within the 30-day retention window (5.1);
//   - logs every access as metadata only and honours admin revocation.
//
// ORDERING NOTE: the recipient list is treated as a reliability chain — the
// head is delivered on release, and the next is activated only if the head
// stays silent for the fallback window (§7 "automatic fallback to the next
// recipient after 14 days of silence"; "random ordering means random
// reliability"). Once the active recipient accesses their content, the chain
// stops advancing.

import type { AuditSink } from '../domain/audit';
import { computeQuorum, type Confirmation } from '../domain/quorum';
import { DAY_MS, POST_RELEASE_RETENTION_DAYS, RECIPIENT_FALLBACK_DAYS } from '../domain/config';
import type { State } from '../domain/states';
import { issueCode, isCodeValid, type OneTimeCode } from './codes';
import type { CodeSms, DeliveryMessage, GatedEmail } from './messages';

export interface ReleaseRecipient {
  readonly recipientId: string;
  readonly email: string | null;
  readonly phone: string | null;
  /** Content items addressed to this recipient (Payload ids). */
  readonly payloadIds: readonly string[];
}

export type DeliveryStatus =
  | 'pending'
  | 'active'
  | 'accessed'
  | 'skipped-self-dealing'
  | 'revoked';

export interface DeliveryRecord {
  recipientId: string;
  status: DeliveryStatus;
  activatedAt: number | null;
  accessedAt: number | null;
  code: OneTimeCode | null;
  linkToken: string | null;
  revoked: boolean;
}

export interface ReleaseStep {
  readonly messages: readonly DeliveryMessage[];
}

/**
 * A serializable snapshot of delivery progress (Phase D). It holds the issued
 * codes and link tokens because the controller must recognise a returning
 * recipient's code across a restart — this is operational delivery state, not
 * the audit trail, so it is kept in the delivery repository and NEVER written to
 * the immutable, metadata-only audit log (DECISIONS.md 5.3; invariant 6/7).
 */
export interface DeliverySnapshot {
  readonly records: readonly DeliveryRecord[];
  readonly activeIndex: number;
}

export type AuthResult =
  | { readonly ok: true; readonly payloadIds: readonly string[] }
  | { readonly ok: false; readonly reason: string };

export type ReissueResult =
  | { readonly ok: true; readonly sms: CodeSms }
  | { readonly ok: false; readonly reason: string };

export class ReleaseNotReadyError extends Error {
  constructor(state: State) {
    super(`release delivery requires PRIVATE_RELEASE, not ${state}`);
    this.name = 'ReleaseNotReadyError';
  }
}

export interface ReleaseControllerOptions {
  readonly state: State;
  readonly privateReleasedAt: number | null;
  readonly recipients: readonly ReleaseRecipient[];
  readonly confirmations: readonly Confirmation[];
  readonly audit: AuditSink;
  readonly codeGenerator?: () => string;
  readonly linkGenerator?: () => string;
}

function randomCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}
function randomLink(): string {
  return `gl_${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
}

export class ReleaseController {
  private readonly state: State;
  private readonly privateReleasedAt: number | null;
  private readonly recipients: readonly ReleaseRecipient[];
  private readonly confirmations: readonly Confirmation[];
  private readonly audit: AuditSink;
  private readonly genCode: () => string;
  private readonly genLink: () => string;

  private readonly recordList: DeliveryRecord[];
  private activeIndex = -1;

  constructor(options: ReleaseControllerOptions) {
    this.state = options.state;
    this.privateReleasedAt = options.privateReleasedAt;
    this.recipients = options.recipients;
    this.confirmations = options.confirmations;
    this.audit = options.audit;
    this.genCode = options.codeGenerator ?? randomCode;
    this.genLink = options.linkGenerator ?? randomLink;
    this.recordList = options.recipients.map((r) => ({
      recipientId: r.recipientId,
      status: 'pending',
      activatedAt: null,
      accessedAt: null,
      code: null,
      linkToken: null,
      revoked: false,
    }));
  }

  begin(at: number): ReleaseStep {
    if (this.state !== 'PRIVATE_RELEASE' || this.privateReleasedAt === null) {
      throw new ReleaseNotReadyError(this.state);
    }
    return this.activateFrom(0, at);
  }

  /**
   * Fallback: if the active recipient has been silent (not accessed) for the
   * 14-day window, activate the next recipient in order (11.4). No-op if the
   * active recipient has already accessed, been revoked, or the window is open.
   */
  advanceIfSilent(at: number): ReleaseStep {
    if (this.activeIndex < 0) return { messages: [] };
    const current = this.recordList[this.activeIndex]!;
    const silentLongEnough =
      current.activatedAt !== null && at - current.activatedAt >= RECIPIENT_FALLBACK_DAYS * DAY_MS;
    if (current.status !== 'active' || !silentLongEnough) {
      return { messages: [] };
    }
    if (this.activeIndex + 1 >= this.recipients.length) {
      return { messages: [] };
    }
    return this.activateFrom(this.activeIndex + 1, at);
  }

  authenticate(linkToken: string, code: string, at: number): AuthResult {
    const index = this.recordList.findIndex((r) => r.linkToken === linkToken);
    if (index < 0) return { ok: false, reason: 'unknown link' };
    const record = this.recordList[index]!;
    if (record.revoked) return { ok: false, reason: 'access has been revoked' };
    if (record.code === null) return { ok: false, reason: 'no code issued' };
    if (!isCodeValid(record.code, code, at)) return { ok: false, reason: 'invalid or expired code' };

    record.accessedAt = at;
    record.status = 'accessed';
    // Access is logged as metadata only — never the code, link, or content.
    this.audit.append({
      at,
      kind: 'OUTREACH',
      event: 'RELEASE_ACCESS',
      metadata: { recipientId: record.recipientId },
    });
    return { ok: true, payloadIds: this.recipients[index]!.payloadIds };
  }

  reissueCode(recipientId: string, at: number): ReissueResult {
    const index = this.recordList.findIndex((r) => r.recipientId === recipientId);
    if (index < 0) return { ok: false, reason: 'unknown recipient' };
    const record = this.recordList[index]!;
    if (record.revoked) return { ok: false, reason: 'access has been revoked' };
    if (record.linkToken === null) return { ok: false, reason: 'recipient not yet activated' };
    if (this.privateReleasedAt === null || at - this.privateReleasedAt > POST_RELEASE_RETENTION_DAYS * DAY_MS) {
      return { ok: false, reason: 'outside the retention window' };
    }
    const phone = this.recipients[index]!.phone;
    if (phone === null) return { ok: false, reason: 'recipient has no phone for SMS' };

    record.code = issueCode(this.genCode(), at);
    this.audit.append({
      at,
      kind: 'OUTREACH',
      event: 'RELEASE_CODE_REISSUE',
      metadata: { recipientId },
    });
    return { ok: true, sms: { channel: 'sms', to: phone, code: record.code.value } };
  }

  revoke(recipientId: string, adminId: string, at: number): { ok: boolean; reason?: string } {
    const record = this.recordList.find((r) => r.recipientId === recipientId);
    if (record === undefined) return { ok: false, reason: 'unknown recipient' };
    record.revoked = true;
    record.status = 'revoked';
    this.audit.append({
      at,
      kind: 'OUTREACH',
      event: 'RELEASE_REVOKE',
      actor: adminId,
      metadata: { recipientId },
    });
    return { ok: true };
  }

  records(): readonly DeliveryRecord[] {
    return this.recordList.map((r) => ({ ...r }));
  }

  /** Export delivery progress for persistence (Phase D). A deep copy. */
  snapshot(): DeliverySnapshot {
    return {
      records: this.recordList.map((r) => ({ ...r, code: r.code === null ? null : { ...r.code } })),
      activeIndex: this.activeIndex,
    };
  }

  /**
   * Rehydrate delivery progress from a persisted snapshot (Phase D). The
   * snapshot's records replace the controller's own — used to reconstruct a
   * controller after a restart so a recipient's already-issued code and link
   * still authenticate. The snapshot must correspond to this controller's
   * recipient list (same ids, same order).
   */
  restore(snapshot: DeliverySnapshot): void {
    if (snapshot.records.length !== this.recordList.length) {
      throw new Error('delivery snapshot does not match the recipient list length');
    }
    for (let i = 0; i < this.recordList.length; i++) {
      const saved = snapshot.records[i]!;
      if (saved.recipientId !== this.recordList[i]!.recipientId) {
        throw new Error(`delivery snapshot recipient mismatch at index ${i}`);
      }
      this.recordList[i] = { ...saved, code: saved.code === null ? null : { ...saved.code } };
    }
    this.activeIndex = snapshot.activeIndex;
  }

  // --- internal -------------------------------------------------------------

  /** Whether delivering to this recipient meets quorum with their own confirmation excluded. */
  private isDeliverable(recipientId: string): boolean {
    return computeQuorum(this.confirmations, { excludeContactId: recipientId }).met;
  }

  /** Activate the first deliverable recipient at or after `startIndex`. */
  private activateFrom(startIndex: number, at: number): ReleaseStep {
    for (let i = startIndex; i < this.recipients.length; i++) {
      const recipient = this.recipients[i]!;
      const record = this.recordList[i]!;
      if (!this.isDeliverable(recipient.recipientId)) {
        record.status = 'skipped-self-dealing';
        this.audit.append({
          at,
          kind: 'OUTREACH',
          event: 'RELEASE_SKIP_SELF_DEALING',
          metadata: { recipientId: recipient.recipientId },
        });
        continue;
      }
      record.status = 'active';
      record.activatedAt = at;
      record.linkToken = this.genLink();
      record.code = issueCode(this.genCode(), at);
      this.activeIndex = i;
      this.audit.append({
        at,
        kind: 'OUTREACH',
        event: 'RELEASE_ACTIVATE',
        metadata: { recipientId: recipient.recipientId },
      });
      return { messages: this.buildMessages(recipient, record) };
    }
    return { messages: [] };
  }

  private buildMessages(recipient: ReleaseRecipient, record: DeliveryRecord): DeliveryMessage[] {
    const messages: DeliveryMessage[] = [];
    if (recipient.email !== null && record.linkToken !== null) {
      const email: GatedEmail = { channel: 'email', to: recipient.email, gatedLink: record.linkToken };
      messages.push(email);
    }
    if (recipient.phone !== null && record.code !== null) {
      const sms: CodeSms = { channel: 'sms', to: recipient.phone, code: record.code.value };
      messages.push(sms);
    }
    return messages;
  }
}
