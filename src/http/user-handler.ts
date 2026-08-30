// Phase F — the user-app management endpoints (DECISIONS_PHASE_F_G.md F2, F6).
//
// The user manages their own roster, recipient order, and content. Every route
// is behind the auth seam (user principals only) and acts ONLY on the caller's
// own account (principal.accountId) — there is no accountId in the body, so
// cross-account access is impossible by construction. The services enforce the
// freeze rule and schema validity; this handler is thin transport.

import {
  AuthoringService,
  PeopleService,
  type ContactEdit,
  type Principal,
} from '../app';
import type { Contact } from '../console';
import type { Payload, PayloadEdit } from '../domain/payload';
import { authorize, bearer, type Authenticator, type AuthPolicy } from './auth';
import { json, type HttpRequest, type HttpResponse } from './message';

export interface UserHandlerDeps {
  readonly authenticator: Authenticator;
  readonly people: PeopleService;
  readonly authoring: AuthoringService;
  readonly now: () => number;
}

const POLICY: AuthPolicy = { allow: ['user'] };

function body(req: HttpRequest): Record<string, unknown> {
  if (req.body === '') return {};
  try {
    const parsed = JSON.parse(req.body) as unknown;
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Map a service result to a response: 404 for a missing account, 409 for a rejected mutation. */
function result(res: { ok: true } | { ok: false; reason: string }): HttpResponse {
  if (res.ok) return json(200, { ok: true });
  if (res.reason === 'account not found') return json(404, { error: res.reason });
  return json(409, { error: res.reason });
}

export function handleUser(req: HttpRequest, deps: UserHandlerDeps): HttpResponse {
  try {
    const decision = authorize(deps.authenticator, bearer(req.headers), POLICY);
    if (!decision.ok) return json(decision.status, { error: decision.reason });
    return route(req, deps, decision.principal);
  } catch {
    return json(500, { error: 'internal error' });
  }
}

function route(req: HttpRequest, deps: UserHandlerDeps, principal: Principal): HttpResponse {
  const accountId = principal.accountId;
  if (accountId === undefined) return json(403, { error: 'principal has no account' });
  const b = body(req);
  const now = deps.now();
  const { people, authoring } = deps;

  switch (`${req.method} ${req.path}`) {
    // --- contacts -----------------------------------------------------------
    case 'GET /me/contacts':
      return json(200, { contacts: people.listContacts(accountId) });
    case 'POST /me/contacts':
      return result(people.addContact(accountId, b['contact'] as Contact));
    case 'POST /me/contacts/update':
      return result(people.updateContact(accountId, String(b['contactId']), (b['edit'] ?? {}) as ContactEdit));
    case 'POST /me/contacts/consent':
      return result(people.recordConsent(accountId, String(b['contactId']), now));
    case 'POST /me/contacts/remove':
      return result(people.removeContact(accountId, String(b['contactId'])));

    // --- recipient order ----------------------------------------------------
    case 'GET /me/recipient-order':
      return json(200, { order: people.getRecipientOrder(accountId) });
    case 'POST /me/recipient-order':
      return result(people.setRecipientOrder(accountId, (b['order'] ?? []) as string[]));

    // --- content ------------------------------------------------------------
    case 'GET /me/content':
      return json(200, { content: authoring.listContent(accountId) });
    case 'POST /me/content':
      return result(authoring.saveContent(accountId, b['payload'] as Payload));
    case 'POST /me/content/edit':
      return result(authoring.editContent(accountId, String(b['payloadId']), (b['changes'] ?? {}) as PayloadEdit, now));
    case 'POST /me/content/remove':
      return result(authoring.deleteContent(accountId, String(b['payloadId'])));

    default:
      return json(404, { error: 'unknown route' });
  }
}
