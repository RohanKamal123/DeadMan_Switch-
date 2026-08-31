// The user-app surface — the account holder's screens, rendered server-side in
// the shared design system (UX_SPEC.md §1). The home screen's whole job is to
// make staying alive effortless and the current state legible in plain language,
// so the check-in control is the single largest element and cancel is always one
// reach away. Every mutating form carries a CSRF token; reads never mutate.

import { page, eyebrow, banner, chip, actionLink, escapeHtml, type BannerKind } from './design';
import type { Contact } from '../console';
import type { Payload } from '../domain/payload';
import { allPlans, priceLabel, type Entitlements, type PlanId } from '../billing';

function hidden(csrf: string): string {
  return `<input type="hidden" name="csrf" value="${escapeHtml(csrf)}">`;
}

function notice(message: string | undefined, kind: 'go' | 'hold' = 'hold'): string {
  if (message === undefined || message === '') return '';
  const cls = kind === 'go' ? 'panel--go' : 'panel--hold';
  return `<div class="panel ${cls}" role="status" style="margin:1rem 0"><p style="margin:0">${escapeHtml(message)}</p></div>`;
}

// --- sign in / sign up ------------------------------------------------------

export function renderAppLogin(opts: { surface: 'app' | 'operator'; error?: string; signupHref?: string }): string {
  const isOp = opts.surface === 'operator';
  const action = isOp ? '/console/login' : '/app/login';
  return page(
    { surface: opts.surface, title: isOp ? 'Operator sign in' : 'Sign in — Legacy Vault' },
    [
      '<section class="wrap measure" style="padding:3.4rem 0">',
      eyebrow(isOp ? 'Operator console' : 'Your account'),
      `<h1>${isOp ? 'Operator sign in' : 'Sign in'}</h1>`,
      notice(opts.error),
      '<div class="panel panel--raise">',
      `<form method="post" action="${action}">`,
      '<label class="field"><span class="lab">Email</span><input type="email" name="identifier" autocomplete="username" required></label>',
      '<label class="field"><span class="lab">Password</span><input type="password" name="password" autocomplete="current-password" required></label>',
      '<div class="actions"><button class="act act--go" type="submit">Sign in</button></div>',
      '</form>',
      '</div>',
      opts.signupHref === undefined
        ? ''
        : `<p class="quiet" style="margin-top:1.2rem">New here? <a href="${escapeHtml(opts.signupHref)}">Create your vault</a>.</p>`,
      isOp
        ? '<p class="quiet" style="margin-top:1.2rem;font-size:.85rem">Operator access is enrolled by an administrator. There is no self-serve reset — recovery is manual and audited.</p>'
        : '',
      '</section>',
    ].join(''),
  );
}

export function renderSignup(opts: { error?: string; email?: string }): string {
  return page(
    { surface: 'public', title: 'Create your vault — Legacy Vault', cookie: true },
    [
      '<section class="wrap measure" style="padding:3.2rem 0">',
      eyebrow('Set up · this is not a quick signup'),
      '<h1>Create your vault</h1>',
      '<p class="lede">Two choices below shape everything that can ever happen. Read them; they are written out in full on purpose.</p>',
      notice(opts.error),
      '<form method="post" action="/app/signup">',
      '<div class="panel panel--raise" style="margin-bottom:1rem">',
      '<div class="eyebrow plain">Account</div>',
      `<label class="field"><span class="lab">Email</span><input type="email" name="email" autocomplete="email" value="${escapeHtml(opts.email ?? '')}" required></label>`,
      '<label class="field"><span class="lab">Password (at least 8 characters)</span><input type="password" name="password" autocomplete="new-password" minlength="8" required></label>',
      '</div>',

      '<div class="panel" style="margin-bottom:1rem">',
      '<div class="eyebrow plain">Evidence mode — choose deliberately</div>',
      '<label style="display:block;margin:.6rem 0"><input type="radio" name="evidence" value="lenient" checked> <strong>Lenient (default)</strong> — three people from three different groups is enough to begin. A coordinated mistake or lie could release early, so the cancel window is longer: <strong>30 days</strong>.</label>',
      '<label style="display:block;margin:.6rem 0"><input type="radio" name="evidence" value="strict"> <strong>Strict</strong> — the same three confirmations, <em>and</em> someone must upload a death certificate before anything is released. Nothing releases without it — possibly never. Cancel window <strong>21 days</strong>.</label>',
      '</div>',

      '<div class="panel" style="margin-bottom:1rem">',
      '<div class="eyebrow plain">Public release — off by default</div>',
      '<label style="display:block;margin:.4rem 0"><input type="checkbox" name="public" value="on"> Turn on public release. Fourteen days after your chosen people receive their content, it is published to a destination you set. <strong>This is the one step that cannot be pulled back.</strong> Leave it off unless you mean it.</label>',
      '</div>',

      '<div class="panel panel--hold" style="margin-bottom:1rem">',
      '<div class="eyebrow plain">Before you finish</div>',
      '<p style="margin:0 0 .6rem">This product cannot grant anyone legal authority. Name your trustees in a valid will and grant your executor authority over your digital assets — read the <a href="/legal/estate">estate advisory</a>. A silent trustee or a locked registrar is the likeliest real failure, not a bug.</p>',
      '<label style="display:block"><input type="checkbox" name="agree" value="on" required> I have read the <a href="/legal/terms">Terms</a>, the <a href="/legal/privacy">Privacy Policy</a>, and understand that our team holds the keys in V1.</label>',
      '</div>',

      '<div class="actions"><button class="act act--go" type="submit">Create vault &amp; sign in</button>' + actionLink({ href: '/app', label: 'I already have one', kind: 'quiet' }) + '</div>',
      '</form>',
      '</section>',
    ].join(''),
  );
}

// --- home / liveness --------------------------------------------------------

export interface HomeView {
  readonly csrf: string;
  readonly bannerKind: BannerKind;
  readonly bannerTitle: string;
  readonly bannerSub: string;
  readonly checkInHint: string;
  readonly planName: string;
  /** True when a hold is running: show the stop control prominently. */
  readonly holdRunning: boolean;
  readonly notice?: string;
}

export function renderAppHome(vm: HomeView): string {
  const stop = vm.holdRunning
    ? [
        '<div class="panel panel--hold" style="margin-top:1.2rem">',
        '<p class="h" style="margin-top:0">A hold is running</p>',
        '<p>Nothing has been released. If you are reading this, stop it — one tap, no login needed from any of our messages, right up to the last second.</p>',
        '<form class="panic-form" method="post" action="/app/check-in">',
        hidden(vm.csrf),
        '<button class="panic" type="submit">I’m alive — stop everything<span class="hint">Cancels the hold and resets every timer.</span></button>',
        '</form>',
        '</div>',
      ].join('')
    : '';
  return page(
    { surface: 'app', title: 'Your vault — Legacy Vault' },
    [
      '<section class="wrap" style="padding:2.6rem 0;max-width:44rem">',
      eyebrow('Your vault · ' + vm.planName),
      notice(vm.notice, 'go'),
      banner(vm.bannerKind, vm.bannerTitle, vm.bannerSub),
      stop,
      '<div style="margin-top:1.6rem">',
      '<form class="panic-form" method="post" action="/app/check-in">',
      hidden(vm.csrf),
      `<button class="panic" type="submit">I’m alive<span class="hint">${escapeHtml(vm.checkInHint)}</span></button>`,
      '</form>',
      '</div>',
      '<div class="panel" style="margin-top:1.6rem">',
      '<p class="h" style="margin-top:0">What happens if you stop checking in</p>',
      '<p class="quiet" style="margin:0">Day 7, 14, 21 — reminders to <strong>you only</strong>. Day 30 — a human review begins. Nothing is ever released without three confirmations and a cancel window you can stop. <a href="/how-it-works">See the full timeline</a>.</p>',
      '</div>',
      '<div class="actions" style="margin-top:1.4rem">',
      actionLink({ href: '/app/people', label: 'People', kind: 'ghost' }),
      actionLink({ href: '/app/content', label: 'Content', kind: 'ghost' }),
      actionLink({ href: '/app/settings', label: 'Settings', kind: 'ghost' }),
      '</div>',
      '</section>',
    ].join(''),
  );
}

// --- people -----------------------------------------------------------------

export interface PeopleView {
  readonly csrf: string;
  readonly contacts: readonly Contact[];
  readonly recipientOrderNames: readonly string[];
  readonly contactCount: number;
  readonly recipientCount: number;
  readonly ent: Entitlements;
  readonly notice?: string;
  readonly frozen: boolean;
}

function contactRow(c: Contact): string {
  const roles = c.roles.map((r) => chip(r, r === 'recipient' ? 'go' : undefined)).join(' ');
  const consent = c.consentAt !== null ? chip('consented', 'go') : chip('consent pending', 'pending');
  const stale = c.stale ? ' ' + chip('details stale', 'hold') : '';
  const reach = [c.email, c.phone].filter((x) => x !== null).join(' · ');
  const both = c.roles.includes('confirmer') && c.roles.includes('recipient');
  const selfDeal = both
    ? `<div class="sub">Because ${escapeHtml(c.name)} also receives content, their own confirmation won’t count toward releasing to them.</div>`
    : '';
  return [
    '<tr>',
    `<td><strong>${escapeHtml(c.name)}</strong><span class="sub">${escapeHtml(reach)}</span>${selfDeal}</td>`,
    `<td>${chip(c.group)}</td>`,
    `<td>${roles}</td>`,
    `<td>${consent}${stale}</td>`,
    '</tr>',
  ].join('');
}

export function renderPeople(vm: PeopleView): string {
  const capNote =
    vm.ent.maxRecipients === Number.POSITIVE_INFINITY
      ? ''
      : `<p class="quiet" style="font-size:.85rem;margin-top:.4rem">Your plan: up to ${vm.ent.maxRecipients} recipients and ${vm.ent.maxContacts} contacts. <a href="/app/billing">Change plan</a>.</p>`;
  const rows = vm.contacts.length === 0
    ? '<tr><td colspan="4" class="quiet">No one added yet.</td></tr>'
    : vm.contacts.map(contactRow).join('');
  const addForm = vm.frozen
    ? '<div class="panel panel--hold"><p style="margin:0">A release is pending, so your roster is frozen. It unfreezes if you cancel.</p></div>'
    : [
        '<div class="panel panel--raise">',
        '<div class="eyebrow plain">Add someone</div>',
        '<form method="post" action="/app/people/add">',
        hidden(vm.csrf),
        '<label class="field"><span class="lab">Name</span><input name="name" required></label>',
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:.8rem">',
        '<label class="field"><span class="lab">Email</span><input type="email" name="email"></label>',
        '<label class="field"><span class="lab">Phone</span><input type="tel" name="phone"></label>',
        '</div>',
        '<label class="field"><span class="lab">Group (why: confirmations must come from different groups)</span><select name="group"><option value="family">family</option><option value="colleague">colleague</option><option value="friend">friend</option><option value="other">other</option></select></label>',
        '<div class="tag-row" style="margin-bottom:.8rem"><label><input type="checkbox" name="confirmer" value="on" checked> may confirm</label> <label><input type="checkbox" name="recipient" value="on"> receives content</label></div>',
        '<div class="actions"><button class="act act--go" type="submit">Add person</button></div>',
        '</form>',
        '</div>',
      ].join('');
  return page(
    { surface: 'app', title: 'People — Legacy Vault' },
    [
      '<section class="wrap" style="padding:2.4rem 0;max-width:48rem">',
      eyebrow('People — contacts & recipients'),
      '<h1>People</h1>',
      '<p class="quiet">Everyone you add is asked to consent before they can confirm anything. Group matters: confirmations must come from three <em>different</em> groups, so no single person can trigger a release alone.</p>',
      capNote,
      notice(vm.notice),
      `<table class="ledger" style="margin:1.2rem 0"><caption>Your people</caption><thead><tr><th>Name</th><th>Group</th><th>Role</th><th>Consent</th></tr></thead><tbody>${rows}</tbody></table>`,
      vm.recipientOrderNames.length > 0
        ? `<p class="quiet"><strong>Delivery order:</strong> ${vm.recipientOrderNames.map((n) => escapeHtml(n)).join(' → ')}. If the first doesn’t respond within 14 days, we move to the next.</p>`
        : '',
      addForm,
      '</section>',
    ].join(''),
  );
}

// --- content ----------------------------------------------------------------

export function renderContent(vm: { items: readonly Payload[]; frozen: boolean }): string {
  const rows = vm.items.length === 0
    ? '<tr><td colspan="3" class="quiet">Nothing stored yet.</td></tr>'
    : vm.items
        .map((it) => {
          const kb = Math.max(1, Math.round(it.byteSize / 1024));
          const addressed = it.recipientIds.length === 0
            ? `${chip('not addressed', 'hold')}`
            : `${it.recipientIds.length} recipient${it.recipientIds.length === 1 ? '' : 's'}`;
          return `<tr><td>${chip(it.kind)}</td><td class="num">${kb} KB</td><td>${addressed}</td></tr>`;
        })
        .join('');
  return page(
    { surface: 'app', title: 'Content — Legacy Vault' },
    [
      '<section class="wrap" style="padding:2.4rem 0;max-width:46rem">',
      eyebrow('Content'),
      '<h1>What you’ve stored</h1>',
      '<p class="quiet">Everything here is stored encrypted. Our team holds the keys in V1 — <a href="/security">see security</a>. Each item is addressed to one or more of your people. ' + (vm.frozen ? 'Authoring is frozen while a release is pending.' : 'You can edit while your account is active.') + '</p>',
      `<table class="ledger" style="margin:1.2rem 0"><caption>Stored items (encrypted)</caption><thead><tr><th>Kind</th><th>Size</th><th>Addressed to</th></tr></thead><tbody>${rows}</tbody></table>`,
      '<p class="quiet" style="font-size:.85rem">Uploading and editing content is done from the desktop app; this view lists what is already stored, without ever showing its contents.</p>',
      '</section>',
    ].join(''),
  );
}

// --- settings ---------------------------------------------------------------

export interface SettingsView {
  readonly csrf: string;
  readonly accountRef: string;
  readonly evidenceMode: string;
  readonly publicReleaseEnabled: boolean;
  readonly planName: string;
  readonly statusLine: string;
}

export function renderSettings(vm: SettingsView): string {
  return page(
    { surface: 'app', title: 'Settings — Legacy Vault' },
    [
      '<section class="wrap" style="padding:2.4rem 0;max-width:44rem">',
      eyebrow('Settings'),
      '<h1>Settings</h1>',
      '<div class="panel"><dl class="kv">',
      `<dt>Account</dt><dd><span class="num">${escapeHtml(vm.accountRef)}</span></dd>`,
      `<dt>Evidence mode</dt><dd>${escapeHtml(vm.evidenceMode)} — to change, contact support (deliberate, audited)</dd>`,
      `<dt>Public release</dt><dd>${vm.publicReleaseEnabled ? 'on' : 'off'}</dd>`,
      `<dt>Plan</dt><dd>${escapeHtml(vm.planName)} — ${escapeHtml(vm.statusLine)} · <a href="/app/billing">manage</a></dd>`,
      '</dl></div>',
      '<div class="panel panel--hold" style="margin-top:1rem">',
      '<p class="h" style="margin-top:0">Recovery is manual, on purpose</p>',
      '<p class="quiet" style="margin:0">There is no self-serve password reset. A person verifies your identity first — slower, so no attacker can reset their way in and force a release.</p>',
      '</div>',
      '<div class="panel" style="margin-top:1rem">',
      '<p class="h" style="margin-top:0">Delete your account</p>',
      '<p class="quiet">Soft-deleted for 7 days (recoverable via manual identity check), then hard-deleted. Content is erased; the audit log keeps metadata only, never content.</p>',
      '</div>',
      '<form method="post" action="/app/logout" style="margin-top:1.4rem">',
      hidden(vm.csrf),
      '<button class="act act--ghost" type="submit">Sign out</button>',
      '</form>',
      '</section>',
    ].join(''),
  );
}

// --- billing ----------------------------------------------------------------

export interface BillingView {
  readonly csrf: string;
  readonly currentPlanId: PlanId;
  readonly statusLine: string;
  readonly hasCustomer: boolean;
  readonly notice?: string;
}

export function renderBilling(vm: BillingView): string {
  const cols = allPlans()
    .map((plan) => {
      const current = plan.id === vm.currentPlanId;
      const bullets = plan.includes.map((b) => `<li style="margin:.3rem 0">${escapeHtml(b)}</li>`).join('');
      const cta = current
        ? '<span class="chip chip--go">Current plan</span>'
        : plan.id === 'free'
          ? '<span class="quiet" style="font-size:.85rem">Downgrade from the billing portal</span>'
          : `<form method="post" action="/app/billing/checkout"><input type="hidden" name="csrf" value="${escapeHtml(vm.csrf)}"><input type="hidden" name="plan" value="${plan.id}"><button class="act act--go" type="submit">Choose ${escapeHtml(plan.name)}</button></form>`;
      return [
        `<div class="panel${current ? ' panel--go' : ''}" style="display:flex;flex-direction:column">`,
        `<div class="eyebrow plain">${escapeHtml(plan.name)}</div>`,
        `<div class="serif" style="font-size:1.7rem;line-height:1">${escapeHtml(priceLabel(plan))}</div>`,
        `<ul class="quiet" style="list-style:none;margin:.6rem 0 1rem;padding:0;font-size:.88rem">${bullets}</ul>`,
        `<div style="margin-top:auto">${cta}</div>`,
        '</div>',
      ].join('');
    })
    .join('');
  const portal = vm.hasCustomer
    ? `<form method="post" action="/app/billing/portal" style="margin-top:1.2rem"><input type="hidden" name="csrf" value="${escapeHtml(vm.csrf)}"><button class="act act--ghost" type="submit">Manage or cancel in the billing portal</button></form>`
    : '';
  return page(
    { surface: 'app', title: 'Plan — Legacy Vault' },
    [
      '<section class="wrap" style="padding:2.4rem 0">',
      eyebrow('Plan & billing'),
      '<h1>Your plan</h1>',
      `<p class="quiet">Current: <strong>${escapeHtml(vm.currentPlanId)}</strong> — ${escapeHtml(vm.statusLine)}. A lapse never deletes content or changes a release you configured; it only limits new set-up actions.</p>`,
      notice(vm.notice, 'go'),
      `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(14rem,1fr));gap:1rem;margin-top:1.4rem">${cols}</div>`,
      portal,
      '</section>',
    ].join(''),
  );
}
