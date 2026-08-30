// Phase F — the authentication/authorization seam (DECISIONS_PHASE_F_G.md F3).
//
// F defines the auth BOUNDARY and ships it as an interface plus a dev-only stub;
// the real credential/session implementation is Phase G3. Two load-bearing rules
// live here:
//   - Every non-cancel, non-recipient endpoint attaches an `AuthPolicy`. An
//     endpoint with NO policy is DENIED, not open — the fail-safe default. A
//     surface added without deciding its audience fails closed.
//   - `authorize` returns the authenticated principal so the app service can log
//     WHO performed a mutation (invariant 7).

import type { Principal, PrincipalKind } from '../app/principal';

export interface Authenticator {
  /** Resolve a credential (e.g. a bearer token) to a principal, or null. */
  authenticate(credential: string | undefined): Principal | null;
}

/**
 * A dev-only authenticator: a fixed map of credential → principal. It exists so
 * Phase F endpoints are testable and runnable before the real login/session work
 * of Phase G3. NEVER use in production — it performs no real credential check.
 */
export class DevAuthenticator implements Authenticator {
  constructor(private readonly credentials: Readonly<Record<string, Principal>>) {}

  authenticate(credential: string | undefined): Principal | null {
    if (credential === undefined) return null;
    return this.credentials[credential] ?? null;
  }
}

/** Extract a bearer token from a header bag, or undefined. */
export function bearer(headers: Readonly<Record<string, string>> | undefined): string | undefined {
  const value = headers?.['authorization'];
  if (value === undefined) return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(value);
  return match ? match[1] : undefined;
}

export interface AuthPolicy {
  /** The principal kinds this endpoint admits. */
  readonly allow: readonly PrincipalKind[];
}

export type AuthDecision =
  | { readonly ok: true; readonly principal: Principal }
  | { readonly ok: false; readonly status: 401 | 403; readonly reason: string };

/**
 * Authenticate a credential and check it against an endpoint's policy.
 *   - no policy  → 403 (fail-safe default: unpolicied endpoints deny);
 *   - no / bad credential → 401;
 *   - principal kind not permitted → 403;
 *   - otherwise → ok, with the principal for the audit trail.
 */
export function authorize(
  authenticator: Authenticator,
  credential: string | undefined,
  policy: AuthPolicy | undefined,
): AuthDecision {
  if (policy === undefined) {
    return { ok: false, status: 403, reason: 'no auth policy: denied' };
  }
  if (credential === undefined || credential === '') {
    return { ok: false, status: 401, reason: 'authentication required' };
  }
  const principal = authenticator.authenticate(credential);
  if (principal === null) {
    return { ok: false, status: 401, reason: 'invalid credential' };
  }
  if (!policy.allow.includes(principal.kind)) {
    return { ok: false, status: 403, reason: 'principal not permitted' };
  }
  return { ok: true, principal };
}
