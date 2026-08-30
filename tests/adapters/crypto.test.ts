// Phase G — envelope encryption (DECISIONS_PHASE_F_G.md G2; DECISIONS.md 8.1).

import { randomBytes } from 'crypto';
import { envelopeIsEncrypted } from '../../src/domain/payload';
import {
  EnvelopeCrypto,
  EnvelopeDecryptError,
  LocalKeyWrapper,
  WrongKeyError,
  ENVELOPE_ALGORITHM,
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
