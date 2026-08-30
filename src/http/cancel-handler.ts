// Phase F — the cancel HTTP handler (DECISIONS_PHASE_F_G.md F1).
//
// A PURE function over a parsed request. The thin server (`server.ts`) parses a
// socket into `HttpRequest` and writes the returned `HttpResponse` back; all the
// behaviour lives here so it can be tested exhaustively without a socket.
//
// The design rules this file enforces (all from F1):
//   - GET renders, POST cancels. A GET has no side effect, so a link prefetcher,
//     a mail-scanner, or an antivirus URL preview following the link cannot fire
//     a cancel (F1.1). The token IS the capability and its only power is the safe
//     one (cancel), so no separate CSRF token is required — the deliberate
//     exception to "GET safe / POST guarded", justified because there is no
//     unsafe action to protect and a login/CSRF handshake would break the
//     no-login requirement (DECISIONS.md 6.1).
//   - Nothing dead-ends (F1.2, invariant 1). A bad/missing/forged token, an
//     unknown account, an unsupported method, or ANY thrown error degrades to
//     the fail-safe page with the support path + in-app cancel. The whole body
//     is wrapped in try/catch so even a store outage renders the fallback rather
//     than a naked 500 — the cancel surface has no failure that leaves a living
//     user without a way out.

import type { CancelService } from '../app';
import { html, type HttpRequest, type HttpResponse } from './message';
import { renderConfirmPage, renderFailSafePage, renderSuccessPage, type CancelFallback } from './pages';

export interface CancelHandlerDeps {
  readonly service: CancelService;
  readonly fallback: CancelFallback;
  readonly now: () => number;
}

/** Fail-safe page. The single place a stuck user is never left without a way out. */
function failSafe(deps: CancelHandlerDeps, status = 200): HttpResponse {
  return html(status, renderFailSafePage(deps.fallback));
}

/** Pull the token out of a POST body — either a url-encoded form or JSON. */
function tokenFromBody(req: HttpRequest): string | undefined {
  const contentType = req.contentType ?? '';
  if (contentType.includes('application/json')) {
    try {
      const parsed = JSON.parse(req.body) as { t?: unknown };
      return typeof parsed.t === 'string' ? parsed.t : undefined;
    } catch {
      return undefined;
    }
  }
  // Default: application/x-www-form-urlencoded (what the confirm-page form sends).
  const params = new URLSearchParams(req.body);
  return params.get('t') ?? undefined;
}

export function handleCancel(req: HttpRequest, deps: CancelHandlerDeps): HttpResponse {
  try {
    if (req.method === 'GET') {
      const token = req.query['t'];
      if (token === undefined || token === '') return failSafe(deps);
      const preview = deps.service.preview(token, deps.now());
      if (!preview.ok) return failSafe(deps);
      return html(200, renderConfirmPage(token));
    }

    if (req.method === 'POST') {
      const token = tokenFromBody(req);
      if (token === undefined || token === '') return failSafe(deps);
      const outcome = deps.service.redeem(token, deps.now());
      if (!outcome.ok) return failSafe(deps);
      return html(200, renderSuccessPage());
    }

    // Any other method never dead-ends either.
    return failSafe(deps, 405);
  } catch {
    // F1.2: even a store outage or an unexpected error renders the fallback,
    // never a naked 500 that looks like the site is down.
    return failSafe(deps);
  }
}
