// Phase F — static HTML for the cancel surface (DECISIONS_PHASE_F_G.md F1;
// UX_SPEC.md §2).
//
// Every page here is a static, human-written template — a template cannot
// hallucinate (CLAUDE.md), and this is the highest-SLO surface in the product,
// so it has the fewest moving parts possible. The pages carry NOTHING sensitive:
// no content, no recipient name, no access code, and not even the account id —
// only the opaque cancel token, whose sole power is to cancel (the safe
// direction). Consistent with invariant 6's spirit that channels never leak
// content.

/** Where a stuck user is sent when the automatic path fails — never a dead-end. */
export interface CancelFallback {
  /** A human support path (URL or copy). Optional but strongly recommended. */
  readonly supportUrl?: string;
  /** The in-app cancel, reachable after login, as a second fallback. */
  readonly inAppCancelUrl?: string;
}

/** Minimal, dependency-free HTML-attribute/text escaping. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function doc(title: string, inner: string): string {
  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="robots" content="noindex,nofollow">',
    `<title>${escapeHtml(title)}</title>`,
    '</head>',
    `<body>${inner}</body>`,
    '</html>',
  ].join('');
}

/**
 * The confirm page (served on GET). One screen, one action (UX §2). The single
 * control POSTs the token back — the GET itself changes nothing, so a prefetch
 * or scanner following the link can never fire a cancel (F1.1).
 */
export function renderConfirmPage(token: string): string {
  return doc(
    'Stop everything',
    [
      '<main>',
      '<h1>Stop everything and reset</h1>',
      '<p>This stops any pending process on your account and resets it. ',
      'You don’t need to do anything else afterward.</p>',
      '<form method="post" action="/cancel">',
      `<input type="hidden" name="t" value="${escapeHtml(token)}">`,
      '<button type="submit">Stop everything and reset</button>',
      '</form>',
      '</main>',
    ].join(''),
  );
}

/** The success page (served after a POST cancel). Reassuring, final, no upsell. */
export function renderSuccessPage(): string {
  return doc(
    'Done',
    [
      '<main>',
      '<h1>Done</h1>',
      '<p>Everything is stopped. You don’t need to do anything else.</p>',
      '</main>',
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
  return doc(
    'We couldn’t process that link',
    [
      '<main>',
      '<h1>We couldn’t process that link automatically</h1>',
      '<p>Your account has not been changed. You can still stop the process ',
      'using either of these:</p>',
      `<ul>${links.join('')}</ul>`,
      '</main>',
    ].join(''),
  );
}
