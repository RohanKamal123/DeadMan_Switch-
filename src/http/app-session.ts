// Cookie session for the browser-facing surfaces (user app, operator console).
//
// The JSON API authenticates with a bearer token; a browser can't hold one
// safely, so these surfaces carry the same signed session token in an HttpOnly
// cookie instead. The token is exactly the one AuthService issues, so the
// existing SessionAuthenticator validates it unchanged — no second auth system.
//
// State-changing POSTs are protected by a double-submit CSRF token derived from
// the session token itself: an attacker who can make a cross-site request still
// cannot read the victim's HttpOnly cookie, so cannot compute the value. Reads
// (GET) never mutate, matching the cancel surface's GET-safe rule.

import { createHmac, timingSafeEqual } from 'node:crypto';
import type { HttpRequest, HttpResponse } from './message';

export const SESSION_COOKIE = 'lv_session';

/** Parse a Cookie header into a name→value map. */
export function parseCookies(headers: Readonly<Record<string, string>> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  const raw = headers?.['cookie'];
  if (raw === undefined) return out;
  for (const part of raw.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const k = part.slice(0, eq).trim();
    const v = part.slice(eq + 1).trim();
    if (k !== '') out[k] = decodeURIComponent(v);
  }
  return out;
}

export function sessionToken(req: HttpRequest): string | undefined {
  const token = parseCookies(req.headers)[SESSION_COOKIE];
  return token === undefined || token === '' ? undefined : token;
}

/** A Set-Cookie value that stores the session token. `secure` off only for local http. */
export function setSessionCookie(token: string, secure: boolean): string {
  const attrs = ['Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${60 * 60 * 24 * 30}`];
  if (secure) attrs.push('Secure');
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; ${attrs.join('; ')}`;
}

/** A Set-Cookie value that clears the session cookie. */
export function clearSessionCookie(secure: boolean): string {
  const attrs = ['Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
  if (secure) attrs.push('Secure');
  return `${SESSION_COOKIE}=; ${attrs.join('; ')}`;
}

/** Derive the CSRF token bound to a session token. Stable per session, unguessable without it. */
export function csrfToken(token: string): string {
  return createHmac('sha256', token).update('lv-csrf').digest('base64url');
}

/** Constant-time check that a submitted CSRF value matches the session's. */
export function csrfValid(token: string, submitted: string | undefined): boolean {
  if (submitted === undefined) return false;
  const expected = Buffer.from(csrfToken(token));
  const got = Buffer.from(submitted);
  return expected.length === got.length && timingSafeEqual(expected, got);
}

/** A 303 redirect, optionally setting or clearing cookies. */
export function redirect(location: string, setCookie?: string): HttpResponse {
  const headers: Record<string, string> = { location };
  if (setCookie !== undefined) headers['set-cookie'] = setCookie;
  return { status: 303, headers, body: '' };
}
