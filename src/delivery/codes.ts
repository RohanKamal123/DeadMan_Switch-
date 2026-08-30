// One-time release codes (PRODUCT_SPEC.md §PRIVATE_RELEASE; DECISIONS.md 4.2).
// A code is sent by SMS on a channel separate from the gated link, expires in
// 72 hours, and is re-issuable within the retention window.

import { timingSafeEqual } from 'node:crypto';
import { CODE_EXPIRY_HOURS, HOUR_MS } from '../domain/config';

export interface OneTimeCode {
  readonly value: string;
  readonly issuedAt: number;
  readonly expiresAt: number;
}

export function issueCode(value: string, at: number): OneTimeCode {
  return { value, issuedAt: at, expiresAt: at + CODE_EXPIRY_HOURS * HOUR_MS };
}

/**
 * Constant-time string comparison (DECISIONS_PHASE_F_G.md F4: "Verify with a
 * constant-time comparison"). The code is the capability guarding a deceased
 * user's private content, so verification must not leak how many leading
 * characters matched via early-exit timing (CWE-208). The length is compared
 * first — codes are a fixed length, so this reveals nothing useful — and the
 * bytes are then compared with `timingSafeEqual`.
 */
export function constantTimeEquals(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/** Valid iff the presented value matches (constant-time) and the 72-hour window has not closed. */
export function isCodeValid(code: OneTimeCode, presented: string, at: number): boolean {
  return at < code.expiresAt && constantTimeEquals(presented, code.value);
}
