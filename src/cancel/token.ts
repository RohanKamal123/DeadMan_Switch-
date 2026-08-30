// The no-login, 24/7 self-serve cancel link (DECISIONS.md 6.1; UX_SPEC.md §2).
// A signed, single-purpose token whose only power is to cancel — the safe
// direction. Its uptime is the project's highest SLO. A bad or unparseable
// token fails safe (a reason to show the support / in-app fallback), never a
// crash and never a state change.
//
// The token is intentionally NOT given an expiry: a living user must always be
// able to stop everything, and the worst a leaked token can do is cancel a
// release — which never causes a wrongful disclosure.

import { createHmac, timingSafeEqual } from 'crypto';
import type { Machine } from '../domain/machine';

interface CancelPayload {
  readonly accountId: string;
  readonly purpose: 'cancel';
  readonly issuedAt: number;
}

function sign(encoded: string, secret: string): string {
  return createHmac('sha256', secret).update(encoded).digest('base64url');
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export function issueCancelToken(accountId: string, at: number, secret: string): string {
  const payload: CancelPayload = { accountId, purpose: 'cancel', issuedAt: at };
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${encoded}.${sign(encoded, secret)}`;
}

export type CancelVerifyResult =
  | { readonly ok: true; readonly accountId: string }
  | { readonly ok: false; readonly reason: string };

export function verifyCancelToken(token: string, secret: string, _at: number): CancelVerifyResult {
  const parts = token.split('.');
  if (parts.length !== 2) return { ok: false, reason: 'malformed token' };
  const [encoded, signature] = parts as [string, string];
  if (!safeEqual(signature, sign(encoded, secret))) {
    return { ok: false, reason: 'signature mismatch' };
  }
  let payload: Partial<CancelPayload>;
  try {
    payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as Partial<CancelPayload>;
  } catch {
    return { ok: false, reason: 'unparseable payload' };
  }
  if (payload.purpose !== 'cancel' || typeof payload.accountId !== 'string') {
    return { ok: false, reason: 'not a cancel token' };
  }
  return { ok: true, accountId: payload.accountId };
}

export type RedeemResult = { readonly ok: true; readonly accountId: string } | { readonly ok: false; readonly reason: string };

/**
 * Verify a cancel token and, if valid, cancel the machine (invariant 1). A bad
 * token leaves the machine untouched.
 */
export function redeemCancel(
  token: string,
  secret: string,
  at: number,
  machine: Machine,
): RedeemResult {
  const verified = verifyCancelToken(token, secret, at);
  if (!verified.ok) return verified;
  const result = machine.apply({ type: 'CANCEL', at, source: 'cancel-link' });
  if (!result.ok) return { ok: false, reason: result.reason };
  return { ok: true, accountId: verified.accountId };
}
