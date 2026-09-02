// The shared page shell and the small set of primitives every surface composes
// from. One place builds the <head>, the masthead, and the footer, so all four
// audiences read as one product without sharing a screen (UX_SPEC.md §0).

import { escapeHtml } from './escape';
import { BASE_CSS, ENHANCE_JS } from './tokens';

export { escapeHtml } from './escape';

/** Which surface a page belongs to — decides the masthead nav and index policy. */
export type Surface = 'public' | 'app' | 'operator' | 'recipient' | 'cancel';

export interface PageOptions {
  readonly surface: Surface;
  readonly title: string;
  readonly description?: string;
  /** Default true everywhere; the marketing surface opts back in to indexing. */
  readonly indexable?: boolean;
  /** Render the standard footer (legal links). Default true except cancel/recipient. */
  readonly footer?: boolean;
  /** Show the cookie note (public surface only, and only until dismissed). */
  readonly cookie?: boolean;
  /** Pre-rendered masthead; when omitted a per-surface default is used. */
  readonly header?: string;
}

const NAV: Record<Surface, ReadonlyArray<{ href: string; label: string }>> = {
  public: [
    { href: '/how-it-works', label: 'How it works' },
    { href: '/who-its-for', label: 'Who it’s for' },
    { href: '/pricing', label: 'Pricing' },
    { href: '/security', label: 'Security' },
    { href: '/app', label: 'Sign in' },
  ],
  app: [
    { href: '/app', label: 'Home' },
    { href: '/app/people', label: 'People' },
    { href: '/app/content', label: 'Content' },
    { href: '/app/billing', label: 'Plan' },
    { href: '/app/settings', label: 'Settings' },
  ],
  operator: [
    { href: '/console', label: 'Queue' },
    { href: '/console/audit', label: 'Audit' },
  ],
  recipient: [],
  cancel: [],
};

const ROOM: Record<Surface, string> = {
  public: '',
  app: 'Your account',
  operator: 'Operator console',
  recipient: '',
  cancel: '',
};

function masthead(surface: Surface): string {
  const links = NAV[surface];
  const room = ROOM[surface];
  const brandHref = surface === 'operator' ? '/console' : surface === 'app' ? '/app' : '/';
  const nav =
    links.length === 0
      ? room === ''
        ? ''
        : `<span class="roomtag">${escapeHtml(room)}</span>`
      : `<nav class="nav" aria-label="Primary">${links
          .map((l) => `<a href="${escapeHtml(l.href)}">${escapeHtml(l.label)}</a>`)
          .join('')}${
          room === '' ? '' : `<span class="roomtag">${escapeHtml(room)}</span>`
        }</nav>`;
  return [
    '<header class="masthead"><div class="wrap bar">',
    `<a class="brand" href="${escapeHtml(brandHref)}"><span class="mark">LV</span>Legacy Vault</a>`,
    nav,
    '</div></header>',
  ].join('');
}

/** The footer — legal and support links, present on the non-panic surfaces. */
export function siteFooter(): string {
  const col = (heading: string, items: ReadonlyArray<[string, string]>): string =>
    `<div><div class="eyebrow plain">${escapeHtml(heading)}</div>${items
      .map(([href, label]) => `<div><a href="${escapeHtml(href)}">${escapeHtml(label)}</a></div>`)
      .join('')}</div>`;
  return [
    '<footer class="foot"><div class="wrap">',
    '<div class="cols">',
    col('Product', [
      ['/how-it-works', 'How it works'],
      ['/who-its-for', 'Who it’s for'],
      ['/pricing', 'Pricing'],
      ['/security', 'Security & data'],
    ]),
    col('Legal', [
      ['/legal/terms', 'Terms of Service'],
      ['/legal/privacy', 'Privacy Policy'],
      ['/legal/dpa', 'Data Processing Addendum'],
      ['/legal/cookies', 'Cookie Policy'],
      ['/legal/estate', 'Wills & trustees advisory'],
    ]),
    col('Help', [
      ['/app', 'Sign in'],
      ['mailto:support@legacyvault.example', 'Contact support'],
      ['/legal/subprocessors', 'Sub-processors'],
    ]),
    '</div>',
    '<div class="fine">Legacy Vault releases what you stored only if a human operator team and a deterministic cancel window both agree you have died — and you can stop it at any second. Being wrong is worse than being slow. This site does not provide legal advice.</div>',
    '</div></footer>',
  ].join('');
}

/** The cookie note. Honest: the product sets only a session cookie when signed in. */
export function cookieBanner(): string {
  return [
    '<div class="cookie" data-cookie><div class="wrap in">',
    '<p>We use one strictly-necessary session cookie when you are signed in, and your browser’s local storage to remember your theme. No advertising or third-party tracking. <a href="/legal/cookies">Cookie Policy</a>.</p>',
    '<button class="act act--ghost" data-cookie-ok type="button">Understood</button>',
    '</div></div>',
  ].join('');
}

/** Wrap page-body HTML in the full document with the inlined design system. */
export function page(options: PageOptions, main: string): string {
  const indexable = options.indexable === true;
  const withFooter = options.footer ?? (options.surface !== 'cancel' && options.surface !== 'recipient');
  const desc = options.description ?? '';
  const head = [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    indexable ? '' : '<meta name="robots" content="noindex,nofollow">',
    desc === '' ? '' : `<meta name="description" content="${escapeHtml(desc)}">`,
    '<meta name="color-scheme" content="light dark">',
    `<title>${escapeHtml(options.title)}</title>`,
    `<style>${BASE_CSS}</style>`,
    '</head>',
  ].join('');
  const body = [
    '<body><div class="page">',
    options.header ?? masthead(options.surface),
    `<div class="grow">${main}</div>`,
    withFooter ? siteFooter() : '',
    '</div>',
    options.cookie === true ? cookieBanner() : '',
    `<script>${ENHANCE_JS}</script>`,
    '</body></html>',
  ].join('');
  return head + body;
}

// --- primitives -------------------------------------------------------------

export function eyebrow(text: string, plain = false): string {
  return `<div class="eyebrow${plain ? ' plain' : ''}">${escapeHtml(text)}</div>`;
}

export type BannerKind = 'ok' | 'watch' | 'hold' | 'neutral';

/** A plain-language state banner. Never uses internal state names (UX §1.2). */
export function banner(kind: BannerKind, title: string, sub?: string): string {
  const cls = kind === 'neutral' ? '' : ` banner--${kind}`;
  return [
    `<div class="banner${cls}" role="status">`,
    '<span class="dot" aria-hidden="true"></span>',
    '<div>',
    `<p class="t">${escapeHtml(title)}</p>`,
    sub === undefined ? '' : `<p class="s">${escapeHtml(sub)}</p>`,
    '</div></div>',
  ].join('');
}

export interface Action {
  readonly href?: string;
  readonly label: string;
  readonly kind?: 'go' | 'ghost' | 'quiet';
  readonly method?: 'get' | 'post';
  readonly disabled?: boolean;
}

/** A link-style action button. For real mutations use a <form> (see panicForm). */
export function actionLink(a: Action): string {
  const kind = a.kind ?? 'ghost';
  const cls = `act act--${kind}${a.disabled ? ' is-disabled' : ''}`;
  if (a.href === undefined || a.disabled) {
    return `<span class="${cls}" aria-disabled="${a.disabled ? 'true' : 'false'}">${escapeHtml(a.label)}</span>`;
  }
  return `<a class="${cls}" href="${escapeHtml(a.href)}">${escapeHtml(a.label)}</a>`;
}

export function chip(label: string, kind?: 'go' | 'hold' | 'pending'): string {
  return `<span class="chip${kind ? ` chip--${kind}` : ''}">${escapeHtml(label)}</span>`;
}
