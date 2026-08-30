// Phase G — envelope encryption (DECISIONS_PHASE_F_G.md G2; DECISIONS.md 8.1).

import { randomBytes } from 'crypto';
import { envelopeIsEncrypted } from '../../src/domain/payload';
import {
  EnvelopeCrypto,
  EnvelopeDecryptError,
  KeyRingWrapper,
  LocalKeyWrapper,
  WrongKeyError,
  ENVELOPE_ALGORITHM,
  kmsKeyId,
} from '../../src/adapters';

function crypto(keyId = 'kms-1', master = randomBytes(32)): { crypto: EnvelopeCrypto; master: Buffer; keyId: string } {
  const wrapper = new LocalKeyWrapper({ keyId, masterKey: master });
  return { crypto: new EnvelopeCrypto(wrapper), master, keyId };
}

describe('EnvelopeCrypto', () => {
  it('seals and opens content, round-tripping the plaintext', () => {
    const { crypto: c } = crypto();
    const env = c.seal('my last words');
    expect(env.algorithm).toBe(ENVELOPE_ALGORITHM);
    expect(c.openToString(env)).toBe('my last words');
  });

  it('produces an envelope the schema accepts as encrypted (no plaintext field)', () => {
    const { crypto: c } = crypto();
    const env = c.seal('secret');
    expect(envelopeIsEncrypted(env)).toBe(true);
    // The plaintext never appears in the stored envelope.
    expect(JSON.stringify(env)).not.toContain('secret');
  });

  it('detects tampering — a flipped ciphertext byte fails authentication', () => {
    const { crypto: c } = crypto();
    const env = c.seal('intact');
    const raw = Buffer.from(env.ciphertext, 'base64');
    raw[0] = raw[0]! ^ 0xff;
    const tampered = { ...env, ciphertext: raw.toString('base64') };
    expect(() => c.open(tampered)).toThrow(EnvelopeDecryptError);
  });

  it('cannot be opened with a different master key (Shamir-ready seam is real)', () => {
    const sealed = crypto('kms-1');
    const env = sealed.crypto.seal('for the executor');
    const other = new EnvelopeCrypto(new LocalKeyWrapper({ keyId: 'kms-1', masterKey: randomBytes(32) }));
    expect(() => other.open(env)).toThrow(WrongKeyError);
  });

  it('rejects a master key that is not 32 bytes', () => {
    expect(() => new LocalKeyWrapper({ keyId: 'k', masterKey: randomBytes(16) })).toThrow();
  });
});

describe('KeyRingWrapper (G2.1 master-key rotation)', () => {
  const keyA = randomBytes(32);
  const keyB = randomBytes(32);

  it('derives a stable, non-secret key id from the master key material', () => {
    expect(kmsKeyId(keyA)).toBe(kmsKeyId(Buffer.from(keyA)));
    expect(kmsKeyId(keyA)).not.toBe(kmsKeyId(keyB));
    // The id is a fingerprint, not the key: the raw key never appears in it.
    expect(kmsKeyId(keyA)).not.toContain(keyA.toString('hex'));
  });

  it('wraps under the current key and stamps the envelope with its id', () => {
    const crypto = new EnvelopeCrypto(new KeyRingWrapper([keyA]));
    const env = crypto.seal('for the executor');
    expect(env.keyId).toBe(kmsKeyId(keyA));
    expect(crypto.openToString(env)).toBe('for the executor');
  });

  it('rotation: content sealed under an old key still opens after a new key is added', () => {
    // Sealed when keyA was current…
    const before = new EnvelopeCrypto(new KeyRingWrapper([keyA]));
    const env = before.seal('written years ago');
    // …opens under a ring whose current key is now keyB, with keyA kept as previous.
    const after = new EnvelopeCrypto(new KeyRingWrapper([keyB, keyA]));
    expect(after.openToString(env)).toBe('written years ago');
  });

  it('a retired key can no longer open its old content (ring no longer holds it)', () => {
    const before = new EnvelopeCrypto(new KeyRingWrapper([keyA]));
    const env = before.seal('sealed under keyA');
    const onlyB = new EnvelopeCrypto(new KeyRingWrapper([keyB]));
    expect(() => onlyB.open(env)).toThrow(WrongKeyError);
  });

  it('rewrap re-keys an old envelope to the current key without touching ciphertext', () => {
    const ring = new EnvelopeCrypto(new KeyRingWrapper([keyB, keyA]));
    const before = new EnvelopeCrypto(new KeyRingWrapper([keyA]));
    const old = before.seal('re-wrap me');

    const rewrapped = ring.rewrap(old);
    expect(rewrapped.keyId).toBe(kmsKeyId(keyB)); // now names the current key
    expect(rewrapped.ciphertext).toBe(old.ciphertext); // ciphertext untouched — no re-encryption
    expect(rewrapped.encryptedDataKey).not.toBe(old.encryptedDataKey); // only the wrapped key changed
    expect(ring.openToString(rewrapped)).toBe('re-wrap me');

    // Having re-wrapped every envelope, keyA can be dropped and content still opens.
    const onlyB = new EnvelopeCrypto(new KeyRingWrapper([keyB]));
    expect(onlyB.openToString(rewrapped)).toBe('re-wrap me');
  });

  it('rejects an empty key ring', () => {
    expect(() => new KeyRingWrapper([])).toThrow();
  });

  it('rejects a master key that is not 32 bytes', () => {
    expect(() => new KeyRingWrapper([randomBytes(16)])).toThrow();
  });
});
