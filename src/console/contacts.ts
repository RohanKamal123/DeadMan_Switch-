// The contact roster (UX_SPEC.md §1.3). A person may hold two roles —
// confirmer and recipient — on one record (DECISIONS.md 10.3). A contact's
// GROUP is set at enrollment and is the source of truth for quorum diversity;
// the operator never types a group when recording a confirmation.

import type { Group } from '../domain/states';

export type Role = 'confirmer' | 'recipient';

export interface Contact {
  readonly id: string;
  /** Display name — operational only; never written to the audit log (5.3). */
  readonly name: string;
  readonly group: Group;
  readonly roles: readonly Role[];
  readonly email: string | null;
  readonly phone: string | null;
  /** Enrollment-consent timestamp; null means consent is still pending (1.3). */
  readonly consentAt: number | null;
  /** True when contact details are known stale and need re-verification (4.3). */
  readonly stale: boolean;
}

export function isConfirmer(c: Contact): boolean {
  return c.roles.includes('confirmer');
}

export function isRecipient(c: Contact): boolean {
  return c.roles.includes('recipient');
}

export function hasConsent(c: Contact): boolean {
  return c.consentAt !== null;
}

export interface Eligibility {
  readonly ok: boolean;
  readonly reason: string | null;
}

/**
 * Whether this contact's confirmation may be recorded toward quorum. A stale
 * contact must be re-verified first; re-verification updates details only and
 * never substitutes for the confirmation itself (DECISIONS.md 4.3).
 */
export function canRecordConfirmation(c: Contact): Eligibility {
  if (!isConfirmer(c)) {
    return { ok: false, reason: `contact ${c.id} is not a confirmer` };
  }
  if (!hasConsent(c)) {
    return { ok: false, reason: `contact ${c.id} has not given enrollment consent` };
  }
  if (c.stale) {
    return { ok: false, reason: `contact ${c.id} details are stale; re-verify before counting` };
  }
  return { ok: true, reason: null };
}
