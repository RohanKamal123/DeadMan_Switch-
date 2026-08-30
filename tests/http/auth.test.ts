// Phase F — the authentication/authorization seam (DECISIONS_PHASE_F_G.md F3).
//
// F ships the auth BOUNDARY: every non-cancel, non-recipient endpoint requires
// an authenticated principal, whose identity the app service logs (invariant 7).
// The real credential/session implementation is Phase G3; F provides the
// interface plus a dev-only stub. The load-bearing rule pinned here: an endpoint
// with NO auth policy is DENIED, not open (fail-safe default).

import { authorize, bearer, DevAuthenticator, type AuthPolicy } from '../../src/http';

const AUTH = new DevAuthenticator({
  'tok-user-1': { kind: 'user', id: 'u1', accountId: 'a1' },
  'tok-operator': { kind: 'operator', id: 'op1' },
  'tok-admin': { kind: 'admin', id: 'ad1' },
});

const USERS_ONLY: AuthPolicy = { allow: ['user'] };

describe('DevAuthenticator', () => {
  it('resolves a known dev token to its principal', () => {
    expect(AUTH.authenticate('tok-user-1')).toEqual({ kind: 'user', id: 'u1', accountId: 'a1' });
  });
  it('returns null for an unknown or missing credential', () => {
    expect(AUTH.authenticate('nope')).toBeNull();
    expect(AUTH.authenticate(undefined)).toBeNull();
  });
});

describe('bearer()', () => {
  it('extracts the token from an Authorization: Bearer header', () => {
    expect(bearer({ authorization: 'Bearer tok-user-1' })).toBe('tok-user-1');
  });
  it('is undefined when the header is absent or not a bearer token', () => {
    expect(bearer({})).toBeUndefined();
    expect(bearer({ authorization: 'Basic abc' })).toBeUndefined();
    expect(bearer(undefined)).toBeUndefined();
  });
});

describe('authorize()', () => {
  it('DENIES an endpoint with no policy — fail-safe default (F3)', () => {
    const decision = authorize(AUTH, 'tok-user-1', undefined);
    expect(decision.ok).toBe(false);
    if (!decision.ok) expect(decision.status).toBe(403);
  });

  it('401s when no credential is supplied', () => {
    const decision = authorize(AUTH, undefined, USERS_ONLY);
    expect(decision).toMatchObject({ ok: false, status: 401 });
  });

  it('401s on an invalid credential', () => {
    const decision = authorize(AUTH, 'garbage', USERS_ONLY);
    expect(decision).toMatchObject({ ok: false, status: 401 });
  });

  it('403s when the principal kind is not permitted by the policy', () => {
    const decision = authorize(AUTH, 'tok-operator', USERS_ONLY);
    expect(decision).toMatchObject({ ok: false, status: 403 });
  });

  it('admits a permitted principal and returns it (for the audit trail)', () => {
    const decision = authorize(AUTH, 'tok-user-1', USERS_ONLY);
    expect(decision).toEqual({ ok: true, principal: { kind: 'user', id: 'u1', accountId: 'a1' } });
  });
});
