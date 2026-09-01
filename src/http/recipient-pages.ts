// Phase F — the recipient gated page (DECISIONS_PHASE_F_G.md F4; UX_SPEC.md §4).
// Static, human-written templates. The page reveals content only after the link
// (from email) AND the separate-channel code (from SMS) are presented together.
// It carries nothing sensitive in a URL or in the page: no content, no code, no
// recipient name (invariant 6). The gated link and the account handle identify
// WHICH release, and travel in the form the recipient submits — the code is
// never placed in a URL.
//
// This is the most emotionally heavy screen in the product: someone opening a
// message from a person who has died. The design is deliberately quiet — no
// upsell, no marketing chrome, no branding noise. Just who it is from, that they
// arranged this, and a calm way in.

import { escapeHtml, page } from './design';
import type { ReleasedItem } from '../app';

function shell(title: string, inner: string): string {
  return page(
    { surface: 'recipient', title, footer: false },
    `<div class="wrap measure" style="padding-top:3.4rem;padding-bottom:3rem">${inner}</div>`,
  );
}

function hidden(account: string, link: string): string {
  return (
    `<input type="hidden" name="a" value="${escapeHtml(account)}">` +
    `<input type="hidden" name="link" value="${escapeHtml(link)}">`
  );
}

/** The code-entry form: the recipient arrived via the email link, now enters the SMS code. */
export function renderCodeEntryPage(account: string, link: string, notice?: string): string {
  return shell(
    'Access your message',
    [
      '<div class="eyebrow">A message was left for you</div>',
      '<h1>Someone arranged for you to receive this</h1>',
      '<p class="lede">This message was set aside for you in advance, to reach you now. Take your time.</p>',
      notice === undefined
        ? ''
        : `<div class="panel panel--go" role="status" style="margin:1rem 0"><p style="margin:0">${escapeHtml(notice)}</p></div>`,
      '<div class="panel panel--raise" style="margin-top:1.4rem">',
      '<p>Enter the one-time code we sent to your phone by text message.</p>',
      '<form method="post" action="/release">',
      hidden(account, link),
      '<label class="field"><span class="lab">One-time code</span>',
      '<input class="code-input" name="code" inputmode="numeric" autocomplete="one-time-code" aria-label="One-time code"></label>',
      '<div class="actions"><button class="act act--go" type="submit">Unlock</button></div>',
      '</form>',
      '</div>',
      '<form method="post" action="/release/resend" style="margin-top:1rem">',
      hidden(account, link),
      '<button class="act act--quiet" type="submit">Send me a new code</button>',
      '</form>',
      '<p class="quiet" style="margin-top:1.4rem;font-size:.88rem">The code arrives by text, separately from this link, for your protection. It expires after a while; you can always request a new one above.</p>',
    ].join(''),
  );
}

/** One decrypted item, rendered inline (note) or as a download (photo/pdf). Never a raw fetch — the bytes are already here. */
function renderItem(item: ReleasedItem): string {
  if (item.kind === 'note') {
    return `<div class="panel" style="margin-top:1rem"><p style="margin:0;white-space:pre-wrap">${escapeHtml(item.content.toString('utf8'))}</p></div>`;
  }
  // Base64 has no HTML metacharacters; mimeType is still escaped defensively
  // since it lands in a quoted attribute.
  const dataUri = `data:${escapeHtml(item.mimeType)};base64,${item.content.toString('base64')}`;
  if (item.kind === 'photo') {
    return `<div class="panel" style="margin-top:1rem;padding:0;overflow:hidden"><img src="${dataUri}" alt="" style="display:block;max-width:100%;height:auto"></div>`;
  }
  return `<div class="panel" style="margin-top:1rem"><a class="act act--go" download="document.pdf" href="${dataUri}">Download the PDF</a></div>`;
}

/** After a successful unlock: the decrypted content itself, server-rendered per view (G2). */
export function renderUnlockedPage(items: readonly ReleasedItem[]): string {
  const itemCount = items.length;
  const noun = itemCount === 1 ? 'message' : 'messages';
  const heading = itemCount === 0 ? 'Access unlocked' : `Your ${noun} ${itemCount === 1 ? 'is' : 'are'} ready`;
  const body =
    itemCount === 0
      ? '<div class="panel"><p style="margin:0">Nothing could be opened right now. Please contact support and we’ll help.</p></div>'
      : items.map(renderItem).join('');
  return shell(
    'Message unlocked',
    [
      '<div class="eyebrow">Unlocked</div>',
      `<h1>${heading}</h1>`,
      body,
      '<p class="quiet" style="margin-top:1.4rem;font-size:.88rem">You can return to this page with your link and code while access remains open.</p>',
    ].join(''),
  );
}

/** Any failure (bad/expired code, revoked, unknown link). Offers a fresh code when possible. */
export function renderReleaseErrorPage(message: string, retry?: { account: string; link: string }): string {
  const resend =
    retry === undefined
      ? ''
      : [
          '<form method="post" action="/release/resend" style="margin-top:1rem">',
          hidden(retry.account, retry.link),
          '<button class="act act--go" type="submit">Send me a new code</button>',
          '</form>',
        ].join('');
  return shell(
    'We couldn’t unlock that',
    [
      '<div class="eyebrow">Legacy Vault</div>',
      '<h1>We couldn’t unlock that</h1>',
      `<div class="panel"><p style="margin:0">${escapeHtml(message)}</p></div>`,
      resend,
    ].join(''),
  );
}

/** A missing/garbled link: nothing to act on, but never a naked error. */
export function renderReleaseInvalidPage(): string {
  return shell(
    'Link not recognised',
    [
      '<div class="eyebrow">Legacy Vault</div>',
      '<h1>This link isn’t valid</h1>',
      '<div class="panel"><p style="margin:0">Please use the most recent link from your email. If it still doesn’t work, contact support and we’ll help.</p></div>',
    ].join(''),
  );
}
