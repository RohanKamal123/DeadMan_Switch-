// Phase F — the user-app check-in endpoint (DECISIONS_PHASE_F_G.md F2, F3).
//
// The one user-app mutation in this slice. A pure handler over a parsed request.
// It sits behind the auth seam (only a 'user' principal) and enforces resource
// ownership (a user may check in only their OWN account — no cross-account
// reset). It maps to the liveness reset, which the domain never lets advance the
// machine toward release (F2). On any unexpected error it returns 500 rather
// than throw — a missed check-in only DELAYS (the cheap direction); the client
// simply retries.

import { LivenessService, type Principal } from '../app';
import { authorize, bearer, type Authenticator, type AuthPolicy } from './auth';
import { json, type HttpRequest, type HttpResponse } from './message';

export interface CheckInHandlerDeps {
  readonly authenticator: Authenticator;
  readonly liveness: LivenessService;
  readonly now: () => number;
}

/** Only the account owner's app checks in (F3). */
const POLICY: AuthPolicy = { allow: ['user'] };

interface CheckInBody {
  readonly accountId?: string;
  readonly passive?: boolean;
}

function parseBody(req: HttpRequest): CheckInBody {
  if (req.body === '') return {};
  try {
    const parsed = JSON.parse(req.body) as CheckInBody;
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

/** The account a user principal is allowed to act on, given the request body. */
function targetAccount(principal: Principal, body: CheckInBody): string | undefined {
  return body.accountId ?? principal.accountId;
}

export function handleCheckIn(req: HttpRequest, deps: CheckInHandlerDeps): HttpResponse {
  try {
    if (req.method !== 'POST') {
      return json(405, { error: 'method not allowed' });
    }

    const decision = authorize(deps.authenticator, bearer(req.headers), POLICY);
    if (!decision.ok) {
      return json(decision.status, { error: decision.reason });
    }

    const body = parseBody(req);
    const accountId = targetAccount(decision.principal, body);
    if (accountId === undefined) {
      return json(400, { error: 'accountId required' });
    }
    // Ownership: a user may only check in their own account.
    if (decision.principal.accountId !== accountId) {
      return json(403, { error: 'not your account' });
    }

    const outcome = deps.liveness.checkIn(accountId, deps.now(), { passive: body.passive === true });
    if (!outcome.ok) {
      return json(404, { error: outcome.reason });
    }
    return json(200, { state: outcome.state });
  } catch {
    return json(500, { error: 'internal error' });
  }
}
