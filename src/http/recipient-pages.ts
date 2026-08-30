// Phase F — static HTML for the recipient gated page (DECISIONS_PHASE_F_G.md F4;
// UX_SPEC.md §4). Static, human-written templates. The page reveals content only
// after the link (from email) AND the separate-channel code (from SMS) are
// presented together. It carries nothing sensitive in a URL or in the page: no
// content, no code, no recipient name (invariant 6). The gated link and the
// account handle identify WHICH release, and travel in the form the recipient
// submits — the code is never placed in a URL.

import { escapeHtml } from './pages';

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

/** After a successful unlock. Content rendering/decryption itself is Phase G2. */
export function renderUnlockedPage(itemCount: number): string {
  const noun = itemCount === 1 ? 'message' : 'messages';
  return doc(
    'Message unlocked',
    ['<main>', '<h1>Unlocked</h1>', `<p>Your ${noun} ${itemCount === 1 ? 'is' : 'are'} ready — ${itemCount} ${noun}.</p>`, '</main>'].join(''),
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
