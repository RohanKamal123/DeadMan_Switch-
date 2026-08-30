// Phase F — the content-authoring application service (DECISIONS_PHASE_F_G.md
// F2, F6; UX_SPEC.md §1.4; DECISIONS.md 9.1 / 11.5).
//
// User-app authoring over the `Payload` schema. It enforces, at the app-service
// edge, the rules the domain already defines — it invents nothing:
//   - the FREEZE rule: no create/edit/delete once a release is pending
//     (`isEditable`), so content cannot change while a release is in flight;
//   - schema validity against the deployment `ContentPolicy` (size/mime limits
//     are config, never invented here — 11.5);
//   - content is stored as ciphertext only (the schema has no plaintext field);
//   - addressing: every recipientId on an item must be an enrolled recipient.
//
// It performs no state transition and no outreach, so it writes no audit entry.

import type { Contact } from '../console';
import { isRecipient } from '../console';
import {
  editPayload,
  isEditable,
  validatePayload,
  PayloadFrozenError,
  type ContentPolicy,
  type Payload,
  type PayloadEdit,
} from '../domain/payload';
import type { State } from '../domain/states';
import type { ContactRepository, MachineRepository, PayloadRepository } from '../persistence';

export interface AuthoringServiceOptions {
  readonly payloads: PayloadRepository;
  readonly contacts: ContactRepository;
  readonly machines: MachineRepository;
  /** Deployment-supplied size/mime limits (DECISIONS.md 11.5). */
  readonly policy: ContentPolicy;
}

export type AuthoringResult = { readonly ok: true } | { readonly ok: false; readonly reason: string };

export class AuthoringService {
  private readonly payloads: PayloadRepository;
  private readonly contacts: ContactRepository;
  private readonly machines: MachineRepository;
  private readonly policy: ContentPolicy;

  constructor(options: AuthoringServiceOptions) {
    this.payloads = options.payloads;
    this.contacts = options.contacts;
    this.machines = options.machines;
    this.policy = options.policy;
  }

  private state(accountId: string): State | undefined {
    return this.machines.getContext(accountId)?.state;
  }

  private recipientIds(accountId: string): Set<string> {
    return new Set(this.contacts.forAccount(accountId).filter((c: Contact) => isRecipient(c)).map((c) => c.id));
  }

  listContent(accountId: string): readonly Payload[] {
    return this.payloads.forAccount(accountId);
  }

  /** Create or replace a content item. Validates the schema, freeze, and addressing. */
  saveContent(accountId: string, payload: Payload): AuthoringResult {
    const state = this.state(accountId);
    if (state === undefined) return { ok: false, reason: 'account not found' };
    if (!isEditable(state)) {
      return { ok: false, reason: `content is frozen while ${state}` };
    }
    const validation = validatePayload(payload, this.policy);
    if (!validation.ok) return { ok: false, reason: validation.errors.join('; ') };
    const addressCheck = this.checkAddressing(accountId, payload.recipientIds);
    if (!addressCheck.ok) return addressCheck;
    this.payloads.save(accountId, payload);
    return { ok: true };
  }

  /** Edit an existing item (bumps version). Frozen states throw in the domain — caught here. */
  editContent(accountId: string, payloadId: string, changes: PayloadEdit, at: number): AuthoringResult {
    const state = this.state(accountId);
    if (state === undefined) return { ok: false, reason: 'account not found' };
    const existing = this.payloads.get(accountId, payloadId);
    if (existing === undefined) return { ok: false, reason: `unknown content ${payloadId}` };
    if (changes.recipientIds !== undefined) {
      const addressCheck = this.checkAddressing(accountId, changes.recipientIds);
      if (!addressCheck.ok) return addressCheck;
    }
    let edited: Payload;
    try {
      edited = editPayload(existing, changes, state, at);
    } catch (err) {
      if (err instanceof PayloadFrozenError) return { ok: false, reason: err.message };
      throw err;
    }
    const validation = validatePayload(edited, this.policy);
    if (!validation.ok) return { ok: false, reason: validation.errors.join('; ') };
    this.payloads.save(accountId, edited);
    return { ok: true };
  }

  deleteContent(accountId: string, payloadId: string): AuthoringResult {
    const state = this.state(accountId);
    if (state === undefined) return { ok: false, reason: 'account not found' };
    if (!isEditable(state)) {
      return { ok: false, reason: `content is frozen while ${state}` };
    }
    if (this.payloads.get(accountId, payloadId) === undefined) {
      return { ok: false, reason: `unknown content ${payloadId}` };
    }
    this.payloads.delete(accountId, payloadId);
    return { ok: true };
  }

  private checkAddressing(accountId: string, recipientIds: readonly string[]): AuthoringResult {
    const recipients = this.recipientIds(accountId);
    for (const id of recipientIds) {
      if (!recipients.has(id)) return { ok: false, reason: `${id} is not an enrolled recipient` };
    }
    return { ok: true };
  }
}
