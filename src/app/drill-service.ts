// Phase H — the quarterly drill (PRODUCT_SPEC.md §6; DECISIONS.md §12 Phase H).
//
// Contact-detail rot is the most likely failure in the threat model, and the
// drill is its primary mitigation: a real, clearly-labelled test email/SMS to a
// contact that requires no action, confirming their details still work. It sends
// nothing sensitive — no link, no code, no content (invariant 6) — and it never
// touches the state machine. Each drill is logged as metadata only (invariant 7).

import type { AuditSinkFactory } from '../runtime';
import type { EmailPort, SmsPort } from '../adapters/channels/ports';
import type { ContactRepository } from '../persistence';

export interface DrillServiceOptions {
  readonly contacts: ContactRepository;
  readonly email: EmailPort;
  readonly sms: SmsPort;
  readonly auditFor: AuditSinkFactory;
}

const DRILL_SUBJECT = 'Legacy Vault — routine test (no action needed)';
const DRILL_BODY =
  'This is a routine test from Legacy Vault to confirm we can reach you. ' +
  'No action is needed. You are receiving this because someone listed you as a contact.';

export type DrillResult = { readonly ok: true; readonly channels: readonly string[] } | { readonly ok: false; readonly reason: string };

export class DrillService {
  private readonly contacts: ContactRepository;
  private readonly email: EmailPort;
  private readonly sms: SmsPort;
  private readonly auditFor: AuditSinkFactory;

  constructor(options: DrillServiceOptions) {
    this.contacts = options.contacts;
    this.email = options.email;
    this.sms = options.sms;
    this.auditFor = options.auditFor;
  }

  /** Send a labelled drill to one contact on whichever channels they have. */
  runDrill(accountId: string, contactId: string, at: number): DrillResult {
    const contact = this.contacts.get(accountId, contactId);
    if (contact === undefined) return { ok: false, reason: `unknown contact ${contactId}` };

    const channels: string[] = [];
    if (contact.email !== null) {
      this.email.sendEmail(contact.email, DRILL_SUBJECT, DRILL_BODY);
      channels.push('email');
    }
    if (contact.phone !== null) {
      this.sms.sendSms(contact.phone, DRILL_BODY);
      channels.push('sms');
    }
    if (channels.length === 0) return { ok: false, reason: 'contact has no email or phone' };

    this.auditFor(accountId).append({
      at,
      kind: 'OUTREACH',
      event: 'QUARTERLY_DRILL',
      metadata: { contactId, channels: channels.join(',') },
    });
    return { ok: true, channels };
  }
}
