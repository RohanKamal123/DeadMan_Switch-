// Phase F — the recipient gated-page endpoint (DECISIONS_PHASE_F_G.md F4).
//
// This surface has NO auth seam: the capability is the gated link (from email)
// plus the one-time code (from SMS on a separate channel). That is the
// deliberate F3 exception — the recipient has no account and no login. The
// handler:
//   - GET /release?a=&link=  → the code-entry form (reveals nothing; a bad/absent
//     link shows a generic "not recognised" page, never a dead-end);
//   - POST /release {a, link, code} → authenticate; on success the content is
//     unlocked (rendering/decryption itself is Phase G2), on failure a retry page;
//   - POST /release/resend {a, link} → re-issue a fresh code (72h, within the
//     retention window).
//
// Nothing sensitive is ever placed in a URL: the code travels only in a POST
// body, and no content, code, or recipient name appears in any page (invariant 6).

import type { ReleaseService } from '../app';
import { html, json, type HttpRequest, type HttpResponse } from './message';
import {
  renderCodeEntryPage,
  renderReleaseErrorPage,
  renderReleaseInvalidPage,
  renderUnlockedPage,
} from './recipient-pages';

export interface RecipientHandlerDeps {
  readonly release: ReleaseService;
  readonly now: () => number;
}

/** Read a field from a POST body (form-encoded or JSON), falling back to the query. */
function field(req: HttpRequest, name: string): string | undefined {
  const contentType = req.contentType ?? '';
  if (req.body !== '') {
    if (contentType.includes('application/json')) {
      try {
        const parsed = JSON.parse(req.body) as Record<string, unknown>;
        const value = parsed[name];
        if (typeof value === 'string') return value;
      } catch {
        // fall through to query
      }
    } else {
      const value = new URLSearchParams(req.body).get(name);
      if (value !== null) return value;
    }
  }
  return req.query[name];
}

export function handleRecipient(req: HttpRequest, deps: RecipientHandlerDeps): HttpResponse {
  try {
    if (req.method === 'GET' && req.path === '/release') {
      const account = field(req, 'a');
      const link = field(req, 'link');
      if (account === undefined || account === '' || link === undefined || link === '') {
        return html(200, renderReleaseInvalidPage());
      }
      return html(200, renderCodeEntryPage(account, link));
    }

    if (req.method === 'POST' && req.path === '/release') {
      const account = field(req, 'a');
      const link = field(req, 'link');
      const code = field(req, 'code');
      if (!account || !link || !code) {
        return html(200, renderReleaseInvalidPage());
      }
      const result = deps.release.authenticate(account, link, code, deps.now());
      if (!result.ok) {
        return html(200, renderReleaseErrorPage(result.reason, { account, link }));
      }
      return html(200, renderUnlockedPage(result.payloadIds.length));
    }

    if (req.method === 'POST' && req.path === '/release/resend') {
      const account = field(req, 'a');
      const link = field(req, 'link');
      if (!account || !link) {
        return html(200, renderReleaseInvalidPage());
      }
      const result = deps.release.reissueByLink(account, link, deps.now());
      if (!result.ok) {
        return html(200, renderReleaseErrorPage(result.reason));
      }
      return html(200, renderCodeEntryPage(account, link, 'A new code has been sent to your phone.'));
    }

    return json(404, { error: 'not found' });
  } catch {
    // Never dead-end: a failure on the recipient path delays access (the cheap
    // direction), it does not leak content or crash.
    return html(200, renderReleaseInvalidPage());
  }
}
