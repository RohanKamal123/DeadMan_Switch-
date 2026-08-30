// Phase F — the admin endpoints (DECISIONS_PHASE_F_G.md F2; veto path 4).
//
// Thin transport over AdminService, behind the auth seam (admin principals
// only). Freeze/unfreeze and revoke are all audited under the authenticated
// admin id, not a client field. No endpoint writes state directly — freeze goes
// through the guarded transition, revoke through the release engine.

import { AdminService, type Principal } from '../app';
import { authorize, bearer, type Authenticator, type AuthPolicy } from './auth';
import { json, type HttpRequest, type HttpResponse } from './message';

export interface AdminHandlerDeps {
  readonly authenticator: Authenticator;
  readonly admin: AdminService;
  readonly now: () => number;
}

const POLICY: AuthPolicy = { allow: ['admin'] };

function body(req: HttpRequest): Record<string, unknown> {
  if (req.body === '') return {};
  try {
    const parsed = JSON.parse(req.body) as unknown;
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function result(res: { ok: true } | { ok: false; reason: string }): HttpResponse {
  if (res.ok) return json(200, { ok: true });
  if (res.reason === 'account not found') return json(404, { error: res.reason });
  return json(409, { error: res.reason });
}

export function handleAdmin(req: HttpRequest, deps: AdminHandlerDeps): HttpResponse {
  try {
    const decision = authorize(deps.authenticator, bearer(req.headers), POLICY);
    if (!decision.ok) return json(decision.status, { error: decision.reason });
    return route(req, deps, decision.principal);
  } catch {
    return json(500, { error: 'internal error' });
  }
}

function route(req: HttpRequest, deps: AdminHandlerDeps, principal: Principal): HttpResponse {
  if (req.method !== 'POST') return json(405, { error: 'method not allowed' });
  const b = body(req);
  const accountId = b['accountId'];
  if (typeof accountId !== 'string' || accountId === '') return json(400, { error: 'accountId required' });
  const now = deps.now();
  const adminId = principal.id;

  switch (req.path) {
    case '/admin/freeze':
      return result(deps.admin.freeze(accountId, adminId, now));
    case '/admin/unfreeze':
      return result(deps.admin.unfreeze(accountId, adminId, now));
    case '/admin/revoke': {
      const recipientId = b['recipientId'];
      if (typeof recipientId !== 'string' || recipientId === '') {
        return json(400, { error: 'recipientId required' });
      }
      return result(deps.admin.revoke(accountId, recipientId, adminId, now));
    }
    default:
      return json(404, { error: 'unknown admin route' });
  }
}
