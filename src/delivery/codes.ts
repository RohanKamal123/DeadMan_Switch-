// One-time release codes (PRODUCT_SPEC.md §PRIVATE_RELEASE; DECISIONS.md 4.2).
// A code is sent by SMS on a channel separate from the gated link, expires in
// 72 hours, and is re-issuable within the retention window.

import { CODE_EXPIRY_HOURS, HOUR_MS } from '../domain/config';

export interface OneTimeCode {
  readonly value: string;
  readonly issuedAt: number;
  readonly expiresAt: number;
}

export function issueCode(value: string, at: number): OneTimeCode {
  return { value, issuedAt: at, expiresAt: at + CODE_EXPIRY_HOURS * HOUR_MS };
}

/** Valid iff the presented value matches and the 72-hour window has not closed. */
export function isCodeValid(code: OneTimeCode, presented: string, at: number): boolean {
  return presented === code.value && at < code.expiresAt;
}
