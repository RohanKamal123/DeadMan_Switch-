// Phase G — stateless signed sessions (DECISIONS_PHASE_F_G.md G3).
//
// A login issues an HMAC-signed session token that encodes the principal and an
// expiry. `SessionAuthenticator` implements the `Authenticator` interface the
// Phase F endpoints already use, so the real login drops in where the dev stub
// was. The token is stateless (no server session store needed at pilot scale);
// the signing secret is injected, never hard-coded or logged (G4).

import { createHmac, timingSafeEqual } from 'crypto';
import type { Principal, PrincipalKind } from '../../app/principal';
import type { Authenticator } from '../../http';

interface SessionPayload {
  readonly kind: PrincipalKind;
  readonly id: string;
  readonly accountId?: string;
  readonly issuedAt: number;
  readonly expiresAt: number;
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

export function issueSession(
  principal: Principal,
  at: number,
  options: { secret: string; ttlMs: number },
): string {
  const payload: SessionPayload = {
    kind: principal.kind,
    id: principal.id,
    ...(principal.accountId !== undefined ? { accountId: principal.accountId } : {}),
    issuedAt: at,
    expiresAt: at + options.ttlMs,
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${encoded}.${sign(encoded, options.secret)}`;
}

export interface SessionAuthenticatorOptions {
  readonly secret: string;
  /** Supplies "now" for expiry checks (injected for deterministic tests). */
  readonly now: () => number;
}

export class SessionAuthenticator implements Authenticator {
  private readonly secret: string;
  private readonly now: () => number;
  constructor(options: SessionAuthenticatorOptions) {
    this.secret = options.secret;
    this.now = options.now;
  }

  authenticate(credential: string | undefined): Principal | null {
    if (credential === undefined) return null;
    const parts = credential.split('.');
    if (parts.length !== 2) return null;
    const [encoded, signature] = parts as [string, string];
    if (!safeEqual(signature, sign(encoded, this.secret))) return null;
    let payload: SessionPayload;
    try {
      payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as SessionPayload;
    } catch {
      return null;
    }
    if (typeof payload.id !== 'string' || typeof payload.expiresAt !== 'number') return null;
    if (this.now() >= payload.expiresAt) return null; // expired
    return {
      kind: payload.kind,
      id: payload.id,
      ...(payload.accountId !== undefined ? { accountId: payload.accountId } : {}),
    };
  }
}
