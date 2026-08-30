// Phase F — static HTML for the recipient gated page (DECISIONS_PHASE_F_G.md F4;
// UX_SPEC.md §4). Static, human-written templates. The page reveals content only
// after the link (from email) AND the separate-channel code (from SMS) are
// presented together. It carries nothing sensitive in a URL or in the page: no
// content, no code, no recipient name (invariant 6). The gated link and the
// account handle identify WHICH release, and travel in the form the recipient
// submits — the code is never placed in a URL.

import { escapeHtml } from './pages';
import type { RenderableItem } from './recipient-handler';

function doc(title: string, inner: string): string {
  return [
    '<!doctype html>',
    '<html lang="en"><head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="robots" content="noindex,nofollow">',
    `<title>${escapeHtml(title)}</title>`,
    `</head><body>${inner}</body></html>`,
  ].join('');
}

function hidden(account: string, link: string): string {
  return (
    `<input type="hidden" name="a" value="${escapeHtml(account)}">` +
    `<input type="hidden" name="link" value="${escapeHtml(link)}">`
  );
}

/** The code-entry form: the recipient arrived via the email link, now enters the SMS code. */
export function renderCodeEntryPage(account: string, link: string, notice?: string): string {
  return doc(
    'Access your message',
    [
      '<main>',
      '<h1>Access your message</h1>',
      notice === undefined ? '' : `<p role="status">${escapeHtml(notice)}</p>`,
      '<p>Enter the one-time code we sent to your phone by text message.</p>',
      '<form method="post" action="/release">',
      hidden(account, link),
      '<label>One-time code <input name="code" inputmode="numeric" autocomplete="one-time-code"></label>',
      '<button type="submit">Unlock</button>',
      '</form>',
      '<form method="post" action="/release/resend">',
      hidden(account, link),
      '<button type="submit">Send me a new code</button>',
      '</form>',
      '</main>',
    ].join(''),
  );
}

/**
 * After a successful unlock. Renders each decrypted item server-side (F4/G2):
 * a note as escaped text, a photo as an inline image, a PDF as an embedded
 * object — all as data carried in THIS page's body, never in a URL, a query
 * string, or client storage (invariant 6). An item that could not be decrypted
 * is acknowledged but its body withheld, so the page never crashes or leaks.
 * The page shows no recipient id, account id, code, or link.
 */
export function renderUnlockedPage(items: readonly RenderableItem[]): string {
  const count = items.length;
  const noun = count === 1 ? 'message' : 'messages';
  const intro =
    count === 0
      ? '<p>There is nothing addressed to you here.</p>'
      : `<p>Your ${noun} ${count === 1 ? 'is' : 'are'} ready — ${count} ${noun}.</p>`;
  const rendered = items.map((item, i) => renderItem(item, i)).join('');
  return doc('Message unlocked', ['<main>', '<h1>Unlocked</h1>', intro, rendered, '</main>'].join(''));
}

/** Render one decrypted item by kind. Binary is embedded as a data URI in the body. */
function renderItem(item: RenderableItem, index: number): string {
  const heading = `<h2>Message ${index + 1}</h2>`;
  if (!item.available || item.content === null) {
    return `<section>${heading}<p>This item could not be displayed. Please contact support.</p></section>`;
  }
  if (item.kind === 'note') {
    // Text is escaped; whitespace preserved.
    return `<section>${heading}<pre style="white-space:pre-wrap">${escapeHtml(item.content)}</pre></section>`;
  }
  const dataUri = `data:${encodeURIComponent(item.mimeType)};base64,${item.content}`;
  if (item.kind === 'photo') {
    return `<section>${heading}<img alt="Shared photo" src="${dataUri}"></section>`;
  }
  // pdf
  return (
    `<section>${heading}` +
    `<object type="application/pdf" data="${dataUri}" width="100%" height="600">` +
    '<p>Your PDF is ready but cannot be shown inline here.</p>' +
    '</object></section>'
  );
}

/** Any failure (bad/expired code, revoked, unknown link). Offers a fresh code when possible. */
export function renderReleaseErrorPage(message: string, retry?: { account: string; link: string }): string {
  const resend =
    retry === undefined
      ? ''
      : ['<form method="post" action="/release/resend">', hidden(retry.account, retry.link), '<button type="submit">Send me a new code</button>', '</form>'].join('');
  return doc(
    'We couldn’t unlock that',
    ['<main>', '<h1>We couldn’t unlock that</h1>', `<p>${escapeHtml(message)}</p>`, resend, '</main>'].join(''),
  );
}

/** A missing/garbled link: nothing to act on, but never a naked error. */
export function renderReleaseInvalidPage(): string {
  return doc(
    'Link not recognised',
    ['<main>', '<h1>This link isn’t valid</h1>', '<p>Please use the most recent link from your email. If it still doesn’t work, contact support.</p>', '</main>'].join(''),
  );
}
