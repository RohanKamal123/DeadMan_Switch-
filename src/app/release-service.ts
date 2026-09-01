// Phase F — the release application service (DECISIONS_PHASE_F_G.md F4).
//
// The tier that drives the private-release delivery engine over persisted
// state. It owns four responsibilities and no policy of its own:
//   - `begin`: once the machine is in PRIVATE_RELEASE (the HOLD window fully
//     elapsed with no cancel — enforced by the state machine, never here), build
//     the ordered recipient plan from the roster + payload addressing and run
//     the controller's first activation. Ordering is STRICTLY user-defined
//     (PRODUCT_SPEC.md §7, "no randomization"), so `begin` RECEIVES the order —
//     it never derives one.
//   - `authenticate` / `reissueByLink`: the recipient gated page. The controller
//     is reconstructed from the persisted plan + delivery snapshot so a returning
//     recipient authenticates across a restart. Access is allowed only while the
//     account is actually in a release state — a later cancel denies access (the
//     conservative direction).
//   - DECRYPT-AND-SERVE (G2, F4's "content rendered server-side, streamed from
//     decrypted storage per view"): once the link+code authenticate, `authenticate`
//     fetches each addressed payload's ciphertext (inline, or from the configured
//     `BlobStore` when offloaded — G1.1/G2 — transparently either way), opens it
//     with `EnvelopeCrypto`, and returns the plaintext bytes directly. Decryption
//     happens HERE, in the app-service tier — never in the HTTP layer — so it stays
//     testable without a socket and consistent with the rest of the system's
//     layering (Preamble, DECISIONS_PHASE_F_G.md). A payload that fails to load or
//     decrypt is skipped, never thrown — one bad item must never break the whole
//     unlock (fail safe).
//   - `advanceFallback`: activate the next recipient after 14 days of silence
//     (11.4).
//
// Every code/link lives in the delivery snapshot (operational state), never in
// the audit trail; the controller logs each activation, access, reissue, and
// skip as metadata only (invariant 6/7). Decrypted plaintext is likewise never
// logged or persisted — it exists only in the returned `ReleasedItem[]` for the
// HTTP layer to render into that one response.

import {
  ReleaseController,
  type DeliveryMessage,
  type RecipientAccessPolicy,
  type ReissueResult,
  type ReleaseRecipient,
} from '../delivery';
import type { MachineContext } from '../domain/transition';
import type { ContentKind, Payload } from '../domain/payload';
import type { EnvelopeCrypto } from '../adapters/crypto';
import type { BlobStore } from '../adapters/channels';
import type {
  ContactRepository,
  DeliveryRepository,
  MachineRepository,
  PayloadRepository,
  ReleasePlanRepository,
} from '../persistence';
import type { AuditSinkFactory } from '../runtime';
import { isRecipient } from '../console';
import { EXTERNAL_CIPHERTEXT_MARKER } from './authoring-service';

export interface ReleaseServiceOptions {
  readonly machines: MachineRepository;
  readonly contacts: ContactRepository;
  readonly payloads: PayloadRepository;
  readonly plans: ReleasePlanRepository;
  readonly deliveries: DeliveryRepository;
  readonly auditFor: AuditSinkFactory;
  readonly codeGenerator?: () => string;
  readonly linkGenerator?: () => string;
  /** Deployment recipient-access throttle (F4.1). Absent → no cap enforced. */
  readonly accessPolicy?: RecipientAccessPolicy;
  /** Decrypts addressed content for the gated page (G2). Absent → `authenticate` returns no items, `payloadIds` only. */
  readonly crypto?: EnvelopeCrypto;
  /** Resolves ciphertext offloaded to a blob store (G1.1). Absent → ciphertext is read inline (unchanged). */
  readonly blobStore?: BlobStore;
}

export type BeginResult =
  | { readonly ok: true; readonly messages: readonly DeliveryMessage[] }
  | { readonly ok: false; readonly reason: string };

export type FallbackResult = { readonly messages: readonly DeliveryMessage[] };

/** One item of decrypted content, ready for the recipient page to render. */
export interface ReleasedItem {
  readonly payloadId: string;
  readonly kind: ContentKind;
  readonly mimeType: string;
  /** Decrypted plaintext bytes. Never logged, never persisted — exists only for this response. */
  readonly content: Buffer;
}

export type ReleaseAuthResult =
  | { readonly ok: true; readonly payloadIds: readonly string[]; readonly items: readonly ReleasedItem[] }
  | { readonly ok: false; readonly reason: string };

function isReleaseState(ctx: MachineContext): boolean {
  return ctx.state === 'PRIVATE_RELEASE' || ctx.state === 'PUBLIC_RELEASE';
}

export class ReleaseService {
  private readonly machines: MachineRepository;
  private readonly contacts: ContactRepository;
  private readonly payloads: PayloadRepository;
  private readonly plans: ReleasePlanRepository;
  private readonly deliveries: DeliveryRepository;
  private readonly auditFor: AuditSinkFactory;
  private readonly codeGenerator: (() => string) | undefined;
  private readonly linkGenerator: (() => string) | undefined;
  private readonly accessPolicy: RecipientAccessPolicy | undefined;
  private readonly crypto: EnvelopeCrypto | undefined;
  private readonly blobStore: BlobStore | undefined;

  constructor(options: ReleaseServiceOptions) {
    this.machines = options.machines;
    this.contacts = options.contacts;
    this.payloads = options.payloads;
    this.plans = options.plans;
    this.deliveries = options.deliveries;
    this.auditFor = options.auditFor;
    this.codeGenerator = options.codeGenerator;
    this.linkGenerator = options.linkGenerator;
    this.accessPolicy = options.accessPolicy;
    this.crypto = options.crypto;
    this.blobStore = options.blobStore;
  }

  /**
   * Start delivery for an account already in PRIVATE_RELEASE. `orderedRecipientIds`
   * is the user-defined delivery order (§7). Builds the plan from the roster +
   * payload addressing, activates the first deliverable recipient, and persists
   * the plan and the delivery snapshot. Returns the outbound messages (a gated
   * email + a separate-channel code) for the sender to dispatch.
   */
  begin(accountId: string, orderedRecipientIds: readonly string[], at: number): BeginResult {
    const ctx = this.machines.getContext(accountId);
    if (ctx === undefined) return { ok: false, reason: 'account not found' };
    if (ctx.state !== 'PRIVATE_RELEASE') {
      return { ok: false, reason: `release requires PRIVATE_RELEASE, not ${ctx.state}` };
    }
    const recipients = this.buildRecipients(accountId, orderedRecipientIds);
    if (!recipients.ok) return { ok: false, reason: recipients.reason };

    const controller = this.controllerFor(accountId, ctx, recipients.value);
    const step = controller.begin(at);
    this.plans.save(accountId, { recipients: recipients.value });
    this.deliveries.save(accountId, controller.snapshot());
    return { ok: true, messages: step.messages };
  }

  /**
   * The recipient gated page: verify a link + separate-channel code, then
   * decrypt and return the addressed content (G2). Async because reading
   * offloaded ciphertext (G1.1) is real I/O; when no `crypto` is configured
   * `items` is empty and only `payloadIds` is populated (unchanged behavior).
   */
  async authenticate(accountId: string, linkToken: string, code: string, at: number): Promise<ReleaseAuthResult> {
    const loaded = this.reconstruct(accountId);
    if (loaded === undefined) return { ok: false, reason: 'no active release' };
    const result = loaded.controller.authenticate(linkToken, code, at);
    this.deliveries.save(accountId, loaded.controller.snapshot());
    if (!result.ok) return result;
    const items = await this.decryptItems(accountId, result.payloadIds);
    return { ok: true, payloadIds: result.payloadIds, items };
  }

  /** Re-issue a fresh code to the recipient identified by their gated link (72h, within retention). */
  reissueByLink(accountId: string, linkToken: string, at: number): ReissueResult {
    const loaded = this.reconstruct(accountId);
    if (loaded === undefined) return { ok: false, reason: 'no active release' };
    const record = loaded.controller.records().find((r) => r.linkToken === linkToken);
    if (record === undefined) return { ok: false, reason: 'unknown link' };
    const result = loaded.controller.reissueCode(record.recipientId, at);
    this.deliveries.save(accountId, loaded.controller.snapshot());
    return result;
  }

  /** Admin revocation of a recipient's access (§7, UX §3.8). Logged, and denies further access. */
  revoke(accountId: string, recipientId: string, adminId: string, at: number): { ok: boolean; reason?: string } {
    const loaded = this.reconstruct(accountId);
    if (loaded === undefined) return { ok: false, reason: 'no active release' };
    const result = loaded.controller.revoke(recipientId, adminId, at);
    this.deliveries.save(accountId, loaded.controller.snapshot());
    return result;
  }

  /** Fallback after 14 days of recipient silence (11.4): activate the next in order. */
  advanceFallback(accountId: string, at: number): FallbackResult {
    const loaded = this.reconstruct(accountId);
    if (loaded === undefined) return { messages: [] };
    const step = loaded.controller.advanceIfSilent(at);
    this.deliveries.save(accountId, loaded.controller.snapshot());
    return { messages: step.messages };
  }

  // --- internal -------------------------------------------------------------

  /**
   * Fetch and decrypt each addressed payload. Ciphertext is read from the blob
   * store when the payload's envelope carries the offload sentinel (G1.1),
   * otherwise inline from the KV-persisted record (unchanged path). A payload
   * that is missing, has no real ciphertext to read, or fails to decrypt is
   * SKIPPED, not thrown — one bad item must never break the whole unlock
   * (fail safe: the recipient still sees whatever did decrypt).
   */
  private async decryptItems(accountId: string, payloadIds: readonly string[]): Promise<readonly ReleasedItem[]> {
    if (this.crypto === undefined) return [];
    const items: ReleasedItem[] = [];
    for (const payloadId of payloadIds) {
      const payload = this.payloads.get(accountId, payloadId);
      if (payload === undefined) continue;
      const item = await this.decryptOne(accountId, payload);
      if (item !== undefined) items.push(item);
    }
    return items;
  }

  private async decryptOne(accountId: string, payload: Payload): Promise<ReleasedItem | undefined> {
    try {
      const ciphertextB64 = await this.resolveCiphertext(accountId, payload);
      if (ciphertextB64 === undefined) return undefined;
      const envelope = { ...payload.envelope, ciphertext: ciphertextB64 };
      const content = this.crypto!.open(envelope);
      return { payloadId: payload.id, kind: payload.kind, mimeType: payload.mimeType, content };
    } catch {
      return undefined;
    }
  }

  /** Real ciphertext, base64 — from the blob store when offloaded (G1.1), else inline. */
  private async resolveCiphertext(accountId: string, payload: Payload): Promise<string | undefined> {
    if (payload.envelope.ciphertext !== EXTERNAL_CIPHERTEXT_MARKER) return payload.envelope.ciphertext;
    if (this.blobStore === undefined) return undefined; // offloaded, but nothing configured to read it back
    const bytes = await this.blobStore.get(`${accountId}/${payload.id}`);
    return bytes === undefined ? undefined : bytes.toString('base64');
  }

  private buildRecipients(
    accountId: string,
    orderedRecipientIds: readonly string[],
  ): { ok: true; value: ReleaseRecipient[] } | { ok: false; reason: string } {
    const roster = new Map(this.contacts.forAccount(accountId).map((c) => [c.id, c]));
    const allPayloads = this.payloads.forAccount(accountId);
    const value: ReleaseRecipient[] = [];
    for (const recipientId of orderedRecipientIds) {
      const contact = roster.get(recipientId);
      if (contact === undefined) return { ok: false, reason: `unknown recipient ${recipientId}` };
      if (!isRecipient(contact)) return { ok: false, reason: `contact ${recipientId} is not a recipient` };
      const payloadIds = allPayloads.filter((p) => p.recipientIds.includes(recipientId)).map((p) => p.id);
      value.push({ recipientId, email: contact.email, phone: contact.phone, payloadIds });
    }
    return { ok: true, value };
  }

  private controllerFor(
    accountId: string,
    ctx: MachineContext,
    recipients: readonly ReleaseRecipient[],
  ): ReleaseController {
    return new ReleaseController({
      state: ctx.state,
      privateReleasedAt: ctx.privateReleasedAt,
      recipients,
      confirmations: ctx.confirmations,
      audit: this.auditFor(accountId),
      ...(this.codeGenerator !== undefined ? { codeGenerator: this.codeGenerator } : {}),
      ...(this.linkGenerator !== undefined ? { linkGenerator: this.linkGenerator } : {}),
      ...(this.accessPolicy !== undefined ? { accessPolicy: this.accessPolicy } : {}),
    });
  }

  /** Rebuild a controller resting on the persisted plan + delivery snapshot. */
  private reconstruct(accountId: string): { controller: ReleaseController } | undefined {
    const ctx = this.machines.getContext(accountId);
    if (ctx === undefined || !isReleaseState(ctx)) return undefined;
    const plan = this.plans.get(accountId);
    const snapshot = this.deliveries.get(accountId);
    if (plan === undefined || snapshot === undefined) return undefined;
    const controller = this.controllerFor(accountId, ctx, plan.recipients);
    controller.restore(snapshot);
    return { controller };
  }
}
