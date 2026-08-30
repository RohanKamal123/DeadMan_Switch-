// Phase F — the people application service (DECISIONS_PHASE_F_G.md F2;
// UX_SPEC.md §1.3). User-app management of the contact roster and the
// user-defined recipient delivery order.
//
// Two things it protects:
//   - the FREEZE rule (UX_SPEC.md §1.4): once a release is pending
//     (HOLD/PRIVATE_RELEASE/PUBLIC_RELEASE) the roster and order are frozen, so
//     an attacker who seizes a live account cannot re-point recipients while a
//     hold is running. It reuses the domain's existing `isEditable(state)` — no
//     new rule is introduced.
//   - GROUP immutability: a contact's group is set at enrollment and is the
//     source of truth for quorum diversity (invariant 4); it can never be edited.
//
// It performs no state transition and no outreach, so it does not write to the
// audit trail (invariant 7 covers transitions and outreach). It only reads/writes
// the operational roster and order repositories.

import type { Contact } from '../console';
import { isRecipient } from '../console';
import { isEditable } from '../domain/payload';
import type { ContactRepository, MachineRepository, RecipientOrderRepository } from '../persistence';

export interface PeopleServiceOptions {
  readonly contacts: ContactRepository;
  readonly machines: MachineRepository;
  readonly recipientOrders: RecipientOrderRepository;
}

export type PeopleResult = { readonly ok: true } | { readonly ok: false; readonly reason: string };

/** Fields a user may edit after enrollment. Group and consent are NOT here. */
export type ContactEdit = Partial<Pick<Contact, 'name' | 'email' | 'phone' | 'roles'>>;

export class PeopleService {
  private readonly contacts: ContactRepository;
  private readonly machines: MachineRepository;
  private readonly recipientOrders: RecipientOrderRepository;

  constructor(options: PeopleServiceOptions) {
    this.contacts = options.contacts;
    this.machines = options.machines;
    this.recipientOrders = options.recipientOrders;
  }

  /** Reject a mutation if the account is missing or frozen (release pending). */
  private guard(accountId: string): PeopleResult {
    const ctx = this.machines.getContext(accountId);
    if (ctx === undefined) return { ok: false, reason: 'account not found' };
    if (!isEditable(ctx.state)) return { ok: false, reason: `roster is frozen while ${ctx.state}` };
    return { ok: true };
  }

  listContacts(accountId: string): readonly Contact[] {
    return this.contacts.forAccount(accountId);
  }

  addContact(accountId: string, contact: Contact): PeopleResult {
    const guard = this.guard(accountId);
    if (!guard.ok) return guard;
    if (this.contacts.get(accountId, contact.id) !== undefined) {
      return { ok: false, reason: `contact ${contact.id} already exists` };
    }
    this.contacts.save(accountId, contact);
    return { ok: true };
  }

  updateContact(accountId: string, contactId: string, edit: ContactEdit): PeopleResult {
    const guard = this.guard(accountId);
    if (!guard.ok) return guard;
    const existing = this.contacts.get(accountId, contactId);
    if (existing === undefined) return { ok: false, reason: `unknown contact ${contactId}` };
    // Group and consent are immutable here; only the whitelisted fields change.
    const updated: Contact = {
      ...existing,
      ...(edit.name !== undefined ? { name: edit.name } : {}),
      ...(edit.email !== undefined ? { email: edit.email } : {}),
      ...(edit.phone !== undefined ? { phone: edit.phone } : {}),
      ...(edit.roles !== undefined ? { roles: edit.roles } : {}),
    };
    this.contacts.save(accountId, updated);
    return { ok: true };
  }

  /** Record enrollment consent (DECISIONS.md 1.3): stamps the consent timestamp once. */
  recordConsent(accountId: string, contactId: string, at: number): PeopleResult {
    const guard = this.guard(accountId);
    if (!guard.ok) return guard;
    const existing = this.contacts.get(accountId, contactId);
    if (existing === undefined) return { ok: false, reason: `unknown contact ${contactId}` };
    this.contacts.save(accountId, { ...existing, consentAt: at });
    return { ok: true };
  }

  removeContact(accountId: string, contactId: string): PeopleResult {
    const guard = this.guard(accountId);
    if (!guard.ok) return guard;
    if (this.contacts.get(accountId, contactId) === undefined) {
      return { ok: false, reason: `unknown contact ${contactId}` };
    }
    this.contacts.delete(accountId, contactId);
    return { ok: true };
  }

  getRecipientOrder(accountId: string): readonly string[] {
    return this.recipientOrders.get(accountId)?.order ?? [];
  }

  /**
   * Set the user-defined delivery order (§7). Validation is conservative: every
   * id must be a current recipient, ids are unique, and the order must cover ALL
   * current recipients — so no recipient is ever silently dropped from the death
   * path.
   */
  setRecipientOrder(accountId: string, order: readonly string[]): PeopleResult {
    const guard = this.guard(accountId);
    if (!guard.ok) return guard;
    const roster = this.contacts.forAccount(accountId);
    const recipientIds = new Set(roster.filter(isRecipient).map((c) => c.id));

    const seen = new Set<string>();
    for (const id of order) {
      if (!recipientIds.has(id)) return { ok: false, reason: `${id} is not a recipient` };
      if (seen.has(id)) return { ok: false, reason: `duplicate recipient ${id}` };
      seen.add(id);
    }
    if (seen.size !== recipientIds.size) {
      return { ok: false, reason: 'order must cover every recipient' };
    }
    this.recipientOrders.save(accountId, { order: [...order] });
    return { ok: true };
  }
}
