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
//
// OPTIONAL BLOB OFFLOAD (G2, G1.1): when a `BlobStore` is configured, real
// ciphertext bytes are written through to it (a photo/PDF up to the policy's
// byte limit does not belong inline in a SQL row) and the KV-persisted `Payload`
// keeps only a sentinel marker in `envelope.ciphertext` — metadata (kind,
// mimeType, keyId, iv, addressing, timestamps) stays in the KV store exactly as
// before. Writes are fire-and-forget on an internal serial queue (the SAME
// durability model already accepted for `PostgresKeyValueStore`'s writes
// elsewhere in this app) — `flush()` awaits them for a caller that wants a
// durability guarantee (e.g. before shutdown). Absent a `BlobStore`, behavior is
// byte-for-byte identical to before this existed: ciphertext stays inline.

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
import type { BlobStore } from '../adapters/channels';
import type { ContactRepository, MachineRepository, PayloadRepository } from '../persistence';

/**
 * Marks a `Payload.envelope.ciphertext` as offloaded to the configured
 * `BlobStore`, under the same `accountId/payloadId` key `PayloadRepository`
 * already uses. Never collides with real ciphertext: base64 output only ever
 * contains `[A-Za-z0-9+/=]`, and this string contains a character outside that
 * alphabet.
 */
export const EXTERNAL_CIPHERTEXT_MARKER = '@external-blob';

export interface AuthoringServiceOptions {
  readonly payloads: PayloadRepository;
  readonly contacts: ContactRepository;
  readonly machines: MachineRepository;
  /** Deployment-supplied size/mime limits (DECISIONS.md 11.5). */
  readonly policy: ContentPolicy;
  /** Optional blob offload for real ciphertext bytes (G2/G1.1). Absent → ciphertext stays inline (unchanged). */
  readonly blobStore?: BlobStore;
}

export type AuthoringResult = { readonly ok: true } | { readonly ok: false; readonly reason: string };

export class AuthoringService {
  private readonly payloads: PayloadRepository;
  private readonly contacts: ContactRepository;
  private readonly machines: MachineRepository;
  private readonly policy: ContentPolicy;
  private readonly blobStore: BlobStore | undefined;
  private queue: Promise<void> = Promise.resolve();
  private lastError: unknown;

  constructor(options: AuthoringServiceOptions) {
    this.payloads = options.payloads;
    this.contacts = options.contacts;
    this.machines = options.machines;
    this.policy = options.policy;
    this.blobStore = options.blobStore;
  }

  private blobKey(accountId: string, payloadId: string): string {
    return `${accountId}/${payloadId}`;
  }

  private enqueue(work: () => Promise<void>): void {
    this.queue = this.queue.then(work).catch((error: unknown) => {
      this.lastError = error;
    });
  }

  /** Await every pending blob write. Rejects if any write since the last flush failed. */
  async flush(): Promise<void> {
    await this.queue;
    if (this.lastError !== undefined) {
      const error = this.lastError;
      this.lastError = undefined;
      throw error;
    }
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
    this.payloads.save(accountId, this.offload(accountId, payload));
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
    // Only re-write the blob when THIS edit actually changed the content bytes
    // (`changes.envelope` present). A metadata-only edit (e.g. recipientIds)
    // must never re-persist the sentinel over real content — that would
    // silently destroy it.
    const toSave = changes.envelope !== undefined ? this.offload(accountId, edited) : edited;
    this.payloads.save(accountId, toSave);
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
    if (this.blobStore !== undefined) {
      const key = this.blobKey(accountId, payloadId);
      this.enqueue(() => this.blobStore!.delete(key));
    }
    return { ok: true };
  }

  /**
   * When a blob store is configured, queue the real ciphertext for durable
   * write-through and return a copy carrying the sentinel in its place — that
   * copy is what `PayloadRepository` persists. Absent a blob store, returns the
   * payload unchanged (ciphertext stays inline, today's behavior).
   */
  private offload(accountId: string, payload: Payload): Payload {
    if (this.blobStore === undefined) return payload;
    const key = this.blobKey(accountId, payload.id);
    const bytes = Buffer.from(payload.envelope.ciphertext, 'base64');
    this.enqueue(() => this.blobStore!.put(key, bytes));
    return { ...payload, envelope: { ...payload.envelope, ciphertext: EXTERNAL_CIPHERTEXT_MARKER } };
  }

  private checkAddressing(accountId: string, recipientIds: readonly string[]): AuthoringResult {
    const recipients = this.recipientIds(accountId);
    for (const id of recipientIds) {
      if (!recipients.has(id)) return { ok: false, reason: `${id} is not an enrolled recipient` };
    }
    return { ok: true };
  }
}
