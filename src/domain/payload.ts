// Phase C content model — the `Payload` schema (DECISIONS.md 9.1 / 11.5;
// UX_SPEC.md §1.4).
//
// This module fixes the SHAPE of stored content:
//   - the content kinds V1 supports (note / photo / pdf),
//   - the envelope-encryption structure (DECISIONS.md 8.1) — content is only
//     ever stored as ciphertext; there is no plaintext field to leak,
//   - addressing to recipients (UX_SPEC.md §1.4),
//   - versioning for edit-after-save, and
//   - the freeze rule: authoring stops once a release is pending.
//
// It deliberately does NOT hard-code numeric size limits. Those remain an open
// deployment decision (DECISIONS.md 11.5) and CLAUDE.md forbids inventing a
// threshold the spec does not state. Limits are supplied by the caller as a
// `ContentPolicy` and merely enforced here.

import { RELEASE_PENDING_STATES, type State } from './states';

export type ContentKind = 'note' | 'photo' | 'pdf';

/**
 * Envelope encryption (DECISIONS.md 8.1): a per-item data key encrypts the
 * content; the data key itself is wrapped by a company-held KMS key. The shape
 * is chosen so trustee key-splitting (Shamir) can wrap `encryptedDataKey`
 * later without a data migration.
 */
export interface EncryptionEnvelope {
  readonly algorithm: string;
  readonly keyId: string;
  readonly encryptedDataKey: string;
  readonly iv: string;
  /** The encrypted content bytes (e.g. base64). Content is NEVER stored in the clear. */
  readonly ciphertext: string;
  readonly version: number;
}

export interface Payload {
  readonly id: string;
  readonly kind: ContentKind;
  readonly mimeType: string;
  /** Size of the plaintext content, in bytes; validated against the policy. */
  readonly byteSize: number;
  readonly envelope: EncryptionEnvelope;
  /** Recipients this item is addressed to (UX_SPEC.md §1.4). Must be ≥1 at release. */
  readonly recipientIds: readonly string[];
  readonly version: number;
  readonly createdAt: number;
  readonly updatedAt: number;
}

/**
 * Deployment-supplied limits. The concrete numbers are an open decision
 * (DECISIONS.md 11.5) and are configured per environment, not baked into the
 * domain.
 */
export interface ContentPolicy {
  readonly maxBytesByKind: Readonly<Record<ContentKind, number>>;
  readonly allowedMimeTypes: Readonly<Record<ContentKind, readonly string[]>>;
}

export interface ValidationResult {
  readonly ok: boolean;
  readonly errors: readonly string[];
}

export class PayloadFrozenError extends Error {
  constructor(state: State) {
    super(`content is frozen while the account is ${state}; authoring is not permitted`);
    this.name = 'PayloadFrozenError';
  }
}

export function envelopeIsEncrypted(envelope: EncryptionEnvelope): boolean {
  return (
    typeof envelope.ciphertext === 'string' &&
    envelope.ciphertext.length > 0 &&
    typeof envelope.encryptedDataKey === 'string' &&
    envelope.encryptedDataKey.length > 0 &&
    typeof envelope.keyId === 'string' &&
    envelope.keyId.length > 0
  );
}

export function validatePayload(payload: Payload, policy: ContentPolicy): ValidationResult {
  const errors: string[] = [];

  const maxBytes = policy.maxBytesByKind[payload.kind];
  if (maxBytes === undefined) {
    errors.push(`no size policy configured for kind "${payload.kind}"`);
  } else if (payload.byteSize > maxBytes) {
    errors.push(`content size ${payload.byteSize} exceeds the ${maxBytes}-byte limit for ${payload.kind}`);
  }
  if (payload.byteSize < 0) {
    errors.push('content size cannot be negative');
  }

  const allowed = policy.allowedMimeTypes[payload.kind];
  if (allowed === undefined) {
    errors.push(`no mime-type policy configured for kind "${payload.kind}"`);
  } else if (!allowed.includes(payload.mimeType)) {
    errors.push(`mime type "${payload.mimeType}" is not allowed for ${payload.kind}`);
  }

  if (!envelopeIsEncrypted(payload.envelope)) {
    errors.push('content must be stored encrypted (envelope ciphertext missing)');
  }

  return { ok: errors.length === 0, errors };
}

/** UX_SPEC.md §1.4: nothing is stored unaddressed at release time. */
export function isAddressed(payload: Payload): boolean {
  return payload.recipientIds.length > 0;
}

export function isComplete(payload: Payload, policy: ContentPolicy): boolean {
  return validatePayload(payload, policy).ok && isAddressed(payload);
}

/**
 * Content is editable until a release is pending. Once a HOLD is running (and
 * through PRIVATE_RELEASE / PUBLIC_RELEASE) the vault is frozen so content
 * cannot change while a release is in flight (UX_SPEC.md §1.4).
 */
export function isEditable(state: State): boolean {
  return !RELEASE_PENDING_STATES.includes(state);
}

export type PayloadEdit = Partial<
  Pick<Payload, 'mimeType' | 'byteSize' | 'envelope' | 'recipientIds'>
>;

export function editPayload(
  payload: Payload,
  changes: PayloadEdit,
  state: State,
  now: number,
): Payload {
  if (!isEditable(state)) {
    throw new PayloadFrozenError(state);
  }
  return {
    ...payload,
    ...changes,
    version: payload.version + 1,
    updatedAt: now,
  };
}
