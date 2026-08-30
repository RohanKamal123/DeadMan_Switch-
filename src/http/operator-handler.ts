// Phase F — the operator-console endpoints (DECISIONS_PHASE_F_G.md F2, F3).
//
// Thin transport over OperatorService, behind the auth seam (operator principals
// only). No endpoint writes state — each maps to a console action, which goes
// through the guarded transition, so every invariant stays in the core. A
// rejected action (START_HOLD before quorum, an ineligible contact, a bad state)
// is surfaced as a 409, never a silent success. The operator id recorded in the
// audit trail (invariant 7) is the authenticated principal's id, not a field the
// client supplies.

import { OperatorService, type OperatorActionResult, type Principal } from '../app';
import type { ContactState } from '../domain/states';
import { authorize, bearer, type Authenticator, type AuthPolicy } from './auth';
import { json, type HttpRequest, type HttpResponse } from './message';

export interface OperatorHandlerDeps {
  readonly authenticator: Authenticator;
  readonly operators: OperatorService;
  readonly now: () => number;
}

/** Only the operator team drives the console (F3). */
const POLICY: AuthPolicy = { allow: ['operator'] };

const CONTACT_STATES: readonly ContactState[] = ['alive', 'deceased', 'accident', 'unknown'];

interface OperatorBody {
  readonly accountId?: string;
  readonly contactId?: string | null;
  readonly state?: string;
  readonly text?: string;
}

function parseBody(req: HttpRequest): OperatorBody {
  if (req.body === '') return {};
  try {
    const parsed = JSON.parse(req.body) as OperatorBody;
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

/** Map an action result to a response: 404 for a missing account, 409 for a rejected action. */
function actionResponse(result: OperatorActionResult): HttpResponse {
  if (result.ok) return json(200, { state: result.state, quorum: result.quorum });
  if (result.reason === 'account not found') return json(404, { error: result.reason });
  return json(409, { error: result.reason });
}

export function handleOperator(req: HttpRequest, deps: OperatorHandlerDeps): HttpResponse {
  try {
    const decision = authorize(deps.authenticator, bearer(req.headers), POLICY);
    if (!decision.ok) return json(decision.status, { error: decision.reason });
    return route(req, deps, decision.principal);
  } catch {
    return json(500, { error: 'internal error' });
  }
}

function route(req: HttpRequest, deps: OperatorHandlerDeps, principal: Principal): HttpResponse {
  const operatorId = principal.id;
  const now = deps.now();
  const svc = deps.operators;

  // Read: GET /operator/case?accountId=...
  if (req.method === 'GET' && req.path === '/operator/case') {
    const accountId = req.query['accountId'];
    if (accountId === undefined || accountId === '') return json(400, { error: 'accountId required' });
    const view = svc.snapshot(accountId);
    if (view === undefined) return json(404, { error: 'account not found' });
    return json(200, view);
  }

  if (req.method !== 'POST') return json(405, { error: 'method not allowed' });

  const body = parseBody(req);
  const accountId = body.accountId;
  if (accountId === undefined || accountId === '') return json(400, { error: 'accountId required' });

  switch (req.path) {
    case '/operator/contact-view': {
      if (!body.contactId) return json(400, { error: 'contactId required' });
      return actionResponse(svc.viewContact(accountId, body.contactId, operatorId, now));
    }
    case '/operator/contact-state': {
      if (!body.contactId) return json(400, { error: 'contactId required' });
      if (body.state === undefined || !CONTACT_STATES.includes(body.state as ContactState)) {
        return json(400, { error: 'valid state required (alive|deceased|accident|unknown)' });
      }
      return actionResponse(
        svc.recordContactState(accountId, body.contactId, body.state as ContactState, operatorId, now),
      );
    }
    case '/operator/notes': {
      if (body.text === undefined) return json(400, { error: 'text required' });
      // contactId may be null for an overall note.
      const contactId = body.contactId ?? null;
      return actionResponse(svc.recordNote(accountId, contactId, body.text, operatorId, now));
    }
    case '/operator/confirmations': {
      if (!body.contactId) return json(400, { error: 'contactId required' });
      return actionResponse(svc.recordConfirmation(accountId, body.contactId, operatorId, now));
    }
    case '/operator/withdrawals': {
      if (!body.contactId) return json(400, { error: 'contactId required' });
      return actionResponse(svc.recordWithdrawal(accountId, body.contactId, operatorId, now));
    }
    case '/operator/hold':
      return actionResponse(svc.startHold(accountId, operatorId, now));
    case '/operator/stalled':
      return actionResponse(svc.markStalled(accountId, operatorId, now));
    case '/operator/reopen':
      return actionResponse(svc.reopenVerification(accountId, operatorId, now));
    default:
      return json(404, { error: 'unknown operator route' });
  }
}
