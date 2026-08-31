// Phase F — the cancel surface (DECISIONS_PHASE_F_G.md F1; UX_SPEC.md §2).
//
// Every page here is a static, human-written template — a template cannot
// hallucinate (CLAUDE.md), and this is the highest-SLO surface in the product,
// so it has the fewest moving parts possible. The pages carry NOTHING sensitive:
// no content, no recipient name, no access code, and not even the account id —
// only the opaque cancel token, whose sole power is to cancel (the safe
// direction). Consistent with invariant 6's spirit that channels never leak
// content.
//
// Visually these use the shared design system, but the cancel surface earns the
// single largest, highest-contrast control in the whole product: the stop
// button. One screen, one action, no competing calls to action, no confirmation
// step that could fail a panicking user (UX §1.6 / §2).

import { escapeHtml, page } from './design';

// escapeHtml historically lived here; re-export keeps its import path stable.
export { escapeHtml } from './design';

/** Where a stuck user is sent when the automatic path fails — never a dead-end. */
export interface CancelFallback {
  /** A human support path (URL or copy). Optional but strongly recommended. */
  readonly supportUrl?: string;
  /** The in-app cancel, reachable after login, as a second fallback. */
  readonly inAppCancelUrl?: string;
}

function shell(title: string, inner: string): string {
  return page({ surface: 'cancel', title, footer: false }, `<div class="wrap measure" style="padding-top:3.4rem;padding-bottom:3rem">${inner}</div>`);
}

/**
 * The confirm page (served on GET). One screen, one action (UX §2). The single
 * control POSTs the token back — the GET itself changes nothing, so a prefetch
 * or scanner following the link can never fire a cancel (F1.1).
 */
export function renderConfirmPage(token: string): string {
  return shell(
    'Stop everything',
    [
      '<div class="eyebrow">Legacy Vault · Stop everything</div>',
      '<h1>Stop everything and reset</h1>',
      '<p class="lede">This stops any pending process on your account and resets it. ',
      'You don’t need to do anything else afterward, and you don’t need to sign in.</p>',
      '<form class="panic-form" method="post" action="/cancel">',
      `<input type="hidden" name="t" value="${escapeHtml(token)}">`,
      '<button class="panic" type="submit">Stop everything and reset<span class="hint">One tap. Nothing has been released.</span></button>',
      '</form>',
      '<p class="quiet" style="margin-top:1.6rem;font-size:.9rem">You can do this at any point — including the last second before anything would be sent. If you reached this page by mistake, you can simply close it; nothing changes until you tap the button.</p>',
    ].join(''),
  );
}

/** The success page (served after a POST cancel). Reassuring, final, no upsell. */
export function renderSuccessPage(): string {
  return shell(
    'Done',
    [
      '<div class="eyebrow">Legacy Vault</div>',
      '<h1>Done</h1>',
      '<div class="panel panel--go" style="margin-top:1.2rem">',
      '<p style="margin:0">Everything is stopped and your account is reset. You don’t need to do anything else. ',
      'Anyone we had contacted will be told it was a false alarm.</p>',
      '</div>',
    ].join(''),
  );
}

/**
 * The fail-safe page. Rendered whenever the automatic cancel could not be
 * completed — a bad or missing token, an unknown account, or a store failure.
 * It NEVER dead-ends (invariant 1 as a UI-uptime property): it always shows the
 * support path and the in-app cancel so a living user has a way to stop the
 * process. It has no dependency that can itself fail — pure static copy plus the
 * configured fallback links.
 */
export function renderFailSafePage(fallback: CancelFallback): string {
  const links: string[] = [];
  if (fallback.supportUrl !== undefined) {
    links.push(
      `<li>Contact support: <a href="${escapeHtml(fallback.supportUrl)}">${escapeHtml(fallback.supportUrl)}</a></li>`,
    );
  }
  if (fallback.inAppCancelUrl !== undefined) {
    links.push(
      `<li>Open the app and cancel from there: <a href="${escapeHtml(fallback.inAppCancelUrl)}">${escapeHtml(fallback.inAppCancelUrl)}</a></li>`,
    );
  }
  return shell(
    'We couldn’t process that link',
    [
      '<div class="eyebrow">Legacy Vault</div>',
      '<h1>We couldn’t process that link automatically</h1>',
      '<p class="lede">Your account has not been changed. You can still stop the process ',
      'using either of these:</p>',
      `<div class="panel"><ul style="margin:0;padding-left:1.1rem">${links.join('')}</ul></div>`,
    ].join(''),
  );
}
