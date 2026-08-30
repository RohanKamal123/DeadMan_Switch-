// Phase G — envelope encryption (DECISIONS_PHASE_F_G.md G2; DECISIONS.md 8.1).
//
// Implements the `EncryptionEnvelope` shape the Phase C `Payload` schema fixed:
//   - each content item is encrypted with a fresh 256-bit DATA KEY using
//     authenticated encryption (AES-256-GCM), so any tamper is detected on open;
//   - the data key is WRAPPED by a company-held master key via a `KeyWrapper`;
//   - only the ciphertext and the wrapped key are stored — plaintext is never
//     persisted and never logged (the schema has no plaintext field).
//
// The wrap step is a SEAM: `KeyWrapper` is an interface, so trustee key-splitting
// (Shamir, 8.1/§8) can replace the single-master wrap later WITHOUT a data
// migration — the stored envelope shape does not change, only who can unwrap.

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';
import type { EncryptionEnvelope } from '../../domain/payload';

export const ENVELOPE_ALGORITHM = 'AES-256-GCM';
const ENVELOPE_VERSION = 1;
const DATA_KEY_BYTES = 32; // AES-256
const IV_BYTES = 12; // GCM standard nonce
const TAG_BYTES = 16;

/**
 * Wraps and unwraps a per-item data key. The V1 implementation is a single
 * company-held master key (envelope encryption, 8.1); a later Shamir-split
 * implementation swaps in here with no change to the stored envelope.
 */
export interface KeyWrapper {
  /** The id of the wrapping key, stored in the envelope so unwrap can find it. */
  readonly keyId: string;
  wrap(dataKey: Buffer): string;
  unwrap(keyId: string, wrapped: string): Buffer;
}

export class WrongKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WrongKeyError';
  }
}

/**
 * A stable, non-secret id for a master key, derived from its material. Storing
 * it in the envelope lets `unwrap` pick the generation that wrapped a given data
 * key, which is what makes master-key ROTATION possible (G2.1): a new key gets a
 * new id, old envelopes keep the old id, and both keys can coexist in the ring
 * until every envelope is re-wrapped. A SHA-256 fingerprint leaks nothing about
 * the 256-bit key (preimage resistance) — the same guarantee a cloud KMS makes
 * by putting a key ARN in the envelope.
 */
export function kmsKeyId(masterKey: Buffer): string {
  return `kms-${createHash('sha256').update(masterKey).digest('hex').slice(0, 16)}`;
}

/**
 * A local master-key wrapper for tests / local dev, standing in for a KMS. The
 * master key is injected (never hard-coded, never logged — G4); a real KMS
 * adapter implements the same interface and is the only place a KMS SDK is
 * imported.
 */
export class LocalKeyWrapper implements KeyWrapper {
  readonly keyId: string;
  private readonly masterKey: Buffer;

  constructor(options: { keyId: string; masterKey: Buffer }) {
    if (options.masterKey.length !== DATA_KEY_BYTES) {
      throw new Error('master key must be 32 bytes (AES-256)');
    }
    this.keyId = options.keyId;
    this.masterKey = options.masterKey;
  }

  wrap(dataKey: Buffer): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', this.masterKey, iv);
    const wrapped = Buffer.concat([cipher.update(dataKey), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, tag, wrapped]).toString('base64');
  }

  unwrap(keyId: string, wrapped: string): Buffer {
    if (keyId !== this.keyId) throw new WrongKeyError(`unknown key id ${keyId}`);
    const raw = Buffer.from(wrapped, 'base64');
    const iv = raw.subarray(0, IV_BYTES);
    const tag = raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
    const body = raw.subarray(IV_BYTES + TAG_BYTES);
    const decipher = createDecipheriv('aes-256-gcm', this.masterKey, iv);
    decipher.setAuthTag(tag);
    try {
      return Buffer.concat([decipher.update(body), decipher.final()]);
    } catch {
      throw new WrongKeyError('data key could not be unwrapped (wrong master key or tampered)');
    }
  }
}

/**
 * The shipping wrapper: a master-key RING with overlapping validity (G2.1),
 * mirroring the cancel-secret rotation model (G4). Given `[current, ...previous]`
 * master keys, it wraps new data keys under the current key and unwraps against
 * whichever key an envelope names — so rotating the master key never strands
 * content already sealed under an older one. Each key is addressed by its
 * `kmsKeyId` fingerprint, so an envelope records the exact generation that
 * wrapped it. A real cloud-KMS adapter implements the same `KeyWrapper` interface
 * (the only place a KMS SDK is imported) and is a drop-in swap here.
 */
export class KeyRingWrapper implements KeyWrapper {
  readonly keyId: string;
  private readonly ring: Map<string, LocalKeyWrapper>;

  /** @param masterKeys `[current, ...previous]`; the first wraps, all can unwrap. */
  constructor(masterKeys: readonly Buffer[]) {
    if (masterKeys.length === 0) {
      throw new Error('KMS key ring needs at least the current master key');
    }
    this.ring = new Map();
    for (const masterKey of masterKeys) {
      const id = kmsKeyId(masterKey);
      // LocalKeyWrapper enforces the 32-byte length; a duplicate key is idempotent.
      if (!this.ring.has(id)) this.ring.set(id, new LocalKeyWrapper({ keyId: id, masterKey }));
    }
    this.keyId = kmsKeyId(masterKeys[0]!);
  }

  wrap(dataKey: Buffer): string {
    return this.ring.get(this.keyId)!.wrap(dataKey);
  }

  unwrap(keyId: string, wrapped: string): Buffer {
    const wrapper = this.ring.get(keyId);
    if (wrapper === undefined) throw new WrongKeyError(`unknown key id ${keyId}`);
    return wrapper.unwrap(keyId, wrapped);
  }
}

export class EnvelopeDecryptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EnvelopeDecryptError';
  }
}

/** Seals plaintext into an `EncryptionEnvelope`, and opens one back to plaintext. */
export class EnvelopeCrypto {
  constructor(private readonly wrapper: KeyWrapper) {}

  seal(plaintext: Buffer | string): EncryptionEnvelope {
    const data = typeof plaintext === 'string' ? Buffer.from(plaintext, 'utf8') : plaintext;
    const dataKey = randomBytes(DATA_KEY_BYTES);
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', dataKey, iv);
    const ciphertext = Buffer.concat([cipher.update(data), cipher.final()]);
    const tag = cipher.getAuthTag();
    return {
      algorithm: ENVELOPE_ALGORITHM,
      keyId: this.wrapper.keyId,
      encryptedDataKey: this.wrapper.wrap(dataKey),
      iv: iv.toString('base64'),
      // ciphertext carries the GCM auth tag appended, so tamper is detected on open.
      ciphertext: Buffer.concat([ciphertext, tag]).toString('base64'),
      version: ENVELOPE_VERSION,
    };
  }

  open(envelope: EncryptionEnvelope): Buffer {
    if (envelope.algorithm !== ENVELOPE_ALGORITHM) {
      throw new EnvelopeDecryptError(`unsupported algorithm ${envelope.algorithm}`);
    }
    const dataKey = this.wrapper.unwrap(envelope.keyId, envelope.encryptedDataKey);
    const iv = Buffer.from(envelope.iv, 'base64');
    const combined = Buffer.from(envelope.ciphertext, 'base64');
    const tag = combined.subarray(combined.length - TAG_BYTES);
    const body = combined.subarray(0, combined.length - TAG_BYTES);
    const decipher = createDecipheriv('aes-256-gcm', dataKey, iv);
    decipher.setAuthTag(tag);
    try {
      return Buffer.concat([decipher.update(body), decipher.final()]);
    } catch {
      throw new EnvelopeDecryptError('content could not be decrypted (wrong key or tampered ciphertext)');
    }
  }

  openToString(envelope: EncryptionEnvelope): string {
    return this.open(envelope).toString('utf8');
  }

  /**
   * Re-wrap an envelope's data key under the CURRENT master key without touching
   * the ciphertext — envelope re-wrap only, no re-encryption (G2.1). Running this
   * over stored envelopes is how an old master key is fully retired after a
   * rotation: once every envelope names the current key, the previous key can be
   * dropped from the ring. The plaintext is never exposed — only the wrapped data
   * key changes. A no-op (fresh wrap under the same key) when already current.
   */
  rewrap(envelope: EncryptionEnvelope): EncryptionEnvelope {
    const dataKey = this.wrapper.unwrap(envelope.keyId, envelope.encryptedDataKey);
    return {
      ...envelope,
      keyId: this.wrapper.keyId,
      encryptedDataKey: this.wrapper.wrap(dataKey),
    };
  }
}
