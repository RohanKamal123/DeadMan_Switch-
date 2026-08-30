// Phase G — the login endpoint (DECISIONS_PHASE_F_G.md G3).
//
// Public by necessity: it is how a caller OBTAINS a session, so it carries no
// principal. It verifies a credential and returns a signed session token the
// other endpoints accept. A failed login is a flat 401 with no detail about
// which half was wrong, and there is no reset endpoint here — recovery is manual
// (8.2). The AuthService is an adapter type, injected, so this handler stays
// thin.

import { json, type HttpRequest, type HttpResponse } from './message';

/** The subset of AuthService this handler needs (avoids a hard adapter import). */
export interface LoginBackend {
  login(identifier: string, password: string, at: number): { ok: true; token: string } | { ok: false; reason: string };
}

export interface LoginHandlerDeps {
  readonly auth: LoginBackend;
  readonly now: () => number;
}

export function handleLogin(req: HttpRequest, deps: LoginHandlerDeps): HttpResponse {
  try {
    if (req.method !== 'POST' || req.path !== '/auth/login') {
      return json(404, { error: 'not found' });
    }
    let identifier: unknown;
    let password: unknown;
    try {
      const parsed = JSON.parse(req.body) as { identifier?: unknown; password?: unknown };
      identifier = parsed.identifier;
      password = parsed.password;
    } catch {
      return json(400, { error: 'invalid body' });
    }
    if (typeof identifier !== 'string' || typeof password !== 'string') {
      return json(400, { error: 'identifier and password required' });
    }
    const result = deps.auth.login(identifier, password, deps.now());
    if (!result.ok) return json(401, { error: 'invalid credentials' });
    return json(200, { token: result.token });
  } catch {
    return json(500, { error: 'internal error' });
  }
}
