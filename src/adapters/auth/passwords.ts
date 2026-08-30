// Phase G — password hashing (DECISIONS_PHASE_F_G.md G3).
//
// scrypt with a per-credential random salt; constant-time comparison on verify.
// No plaintext password is ever stored or logged. This is the low-level
// primitive the credential store builds on.

import { randomBytes, scryptSync, timingSafeEqual } from 'crypto';

const KEYLEN = 64;

export interface PasswordHash {
  readonly salt: string;
  readonly hash: string;
}

export function hashPassword(password: string, salt: string = randomBytes(16).toString('hex')): PasswordHash {
  const hash = scryptSync(password, salt, KEYLEN).toString('hex');
  return { salt, hash };
}

export function verifyPassword(password: string, stored: PasswordHash): boolean {
  const computed = scryptSync(password, stored.salt, KEYLEN);
  const expected = Buffer.from(stored.hash, 'hex');
  if (computed.length !== expected.length) return false;
  return timingSafeEqual(computed, expected);
}
