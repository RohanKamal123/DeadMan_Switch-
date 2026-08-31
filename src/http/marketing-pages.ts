// The public marketing surface (indexable). Static, human-written copy in the
// shared design system. It explains a product about death and trust without
// selling hard: the whole pitch is the asymmetry the engineering is built on —
// being wrong is worse than being slow — so the tone is plain and unhurried, not
// the frictionless SaaS default.

import { page, eyebrow, actionLink, escapeHtml } from './design';
import { allPlans, priceLabel, type Plan } from '../billing';

function pub(title: string, description: string, main: string): string {
  return page({ surface: 'public', title, description, indexable: true, cookie: true }, main);
}

function hero(): string {
  return [
    '<section class="wrap" style="padding:4.2rem 0 2.2rem;max-width:52rem">',
    eyebrow('Posthumous message delivery'),
    '<h1>The letter you hope never gets sent.</h1>',
    '<p class="lede">Legacy Vault holds what you want your people to have — words, photos, instructions — and delivers it only if you have died. Not on a guess. Only after a human team and a deterministic cancel window both agree, and never before you have had every chance to stop it.</p>',
    '<div class="actions" style="margin-top:1.6rem">',
    actionLink({ href: '/app', label: 'Open your vault', kind: 'go' }),
    actionLink({ href: '/how-it-works', label: 'How it works', kind: 'ghost' }),
    '</div>',
    '</section>',
  ].join('');
}

function creed(): string {
  return [
    '<section style="border-top:1px solid var(--rule);border-bottom:1px solid var(--rule);background:var(--surface)">',
    '<div class="wrap" style="padding:2.6rem 0;max-width:48rem">',
    eyebrow('The one rule'),
    '<p class="serif" style="font-size:clamp(1.4rem,3.2vw,2rem);line-height:1.3;margin:0">Releasing while you are alive is catastrophic and cannot be undone. Releasing late costs nothing. Every decision here chooses the slower, safer path — on purpose.</p>',
    '</div></section>',
  ].join('');
}

function howRow(n: string, h: string, body: string): string {
  return [
    '<div class="doc-section">',
    `<div class="n">${n}</div>`,
    `<div><h2>${h}</h2><p class="quiet" style="margin:0">${body}</p></div>`,
    '</div>',
  ].join('');
}

function ladder(): string {
  return [
    '<section class="wrap" style="padding:3rem 0;max-width:48rem">',
    eyebrow('What actually happens'),
    '<h2 style="margin-top:.2rem">Four steps, each of them reversible until the very end.</h2>',
    howRow('01', 'You stay alive, effortlessly', 'A weekly one-tap check-in resets everything. Open the app, reply to an email, or use an opt-in passive signal — any of them is enough. You should almost never hear from us while you are well.'),
    howRow('02', 'If you go quiet, only you hear from us', 'Miss a check-in and the reminders escalate over thirty days — to you, and nobody else. We never contact your people during this window, and every message says so.'),
    howRow('03', 'A human team verifies — carefully', 'After thirty days, a trained operator reaches out to the people you named. Release needs three confirmations from three different groups. No automated calls, no AI deciding anything, no shortcuts.'),
    howRow('04', 'A cancel window you can always stop', 'Even once confirmed, a hold of up to thirty days runs before anything is released. You can stop it with one tap from any message, with no login — including one second before it would send.'),
    '</section>',
  ].join('');
}

function surfaces(): string {
  const card = (tag: string, h: string, body: string): string =>
    `<div class="panel"><div class="eyebrow plain">${tag}</div><div class="h">${h}</div><p class="quiet" style="margin:0">${body}</p></div>`;
  return [
    '<section style="background:var(--surface);border-top:1px solid var(--rule)">',
    '<div class="wrap" style="padding:3rem 0">',
    eyebrow('Built for four people, four moments'),
    '<h2 style="margin:.2rem 0 1.3rem;max-width:40rem">Each surface is designed for its worst moment, and they never share a screen.</h2>',
    '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(15rem,1fr));gap:1rem">',
    card('You, alive', 'Your vault', 'Write and store what matters, name the people who receive it, and stay alive with a single tap. Cancel is never more than one tap away.'),
    card('You, in a panic', 'The stop link', 'A no-login page reached from any message. One screen, one button, stops everything. The highest-uptime thing we run.'),
    card('Our team', 'The operator console', 'Where humans do the verification software must not automate. The careful path is the easy path; the dangerous path does not exist.'),
    card('Your people', 'The recipient page', 'Quiet and plain. A gated link and a separate code — nothing sensitive ever travels in an email or a text.'),
    '</div></div></section>',
  ].join('');
}

function closer(): string {
  return [
    '<section class="wrap center" style="padding:3.4rem 0;max-width:40rem">',
    '<h2 style="margin-top:0">Set it down once. Get on with living.</h2>',
    '<p class="lede">It takes an afternoon to set up and a tap a week to keep. The rest of the time it does nothing at all — which is exactly the point.</p>',
    `<div class="actions" style="justify-content:center;margin-top:1.4rem">${actionLink({ href: '/app', label: 'Open your vault', kind: 'go' })}${actionLink({ href: '/pricing', label: 'See pricing', kind: 'ghost' })}</div>`,
    '</section>',
  ].join('');
}

export function renderLandingPage(): string {
  return pub(
    'Legacy Vault — the letter you hope never gets sent',
    'Legacy Vault delivers your stored messages only if you have died — verified by a human team, held behind a cancel window you can stop at any second.',
    [hero(), creed(), ladder(), surfaces(), closer()].join(''),
  );
}

// --- supporting pages -------------------------------------------------------

function docPage(surfaceTitle: string, description: string, eyebrowText: string, h1: string, lede: string, sections: ReadonlyArray<[string, string, string]>): string {
  const rows = sections
    .map(([n, h, body]) => `<div class="doc-section"><div class="n">${n}</div><div><h2>${h}</h2>${body}</div></div>`)
    .join('');
  return pub(
    surfaceTitle,
    description,
    [
      '<section class="wrap" style="padding:3.4rem 0;max-width:48rem">',
      eyebrow(eyebrowText),
      `<h1>${h1}</h1>`,
      `<p class="lede">${lede}</p>`,
      '<div style="margin-top:1.6rem">',
      rows,
      '</div></section>',
    ].join(''),
  );
}

export function renderHowItWorksPage(): string {
  return docPage(
    'How it works — Legacy Vault',
    'The eight states of a Legacy Vault account and the guarantees behind each.',
    'How it works',
    'A state machine you can audit, not a black box.',
    'Your account is always in exactly one of eight states, and it only ever moves through one guarded step at a time. There are no ad-hoc status changes anywhere in the system, and every move is written to an immutable log.',
    [
      ['①', 'Active', '<p class="quiet" style="margin:0">Normal life. Any signal from you — a tap, an app open, an email reply — resets every timer to zero.</p>'],
      ['②', 'Nudge', '<p class="quiet" style="margin:0">A check-in was missed. Reminders reach <strong>only you</strong>, escalating on days 7, 14 and 21. No one else is contacted.</p>'],
      ['③', 'Verifying', '<p class="quiet" style="margin:0">Day 30. A human operator works your contacts one at a time and records confirmations. No automated calls, ever.</p>'],
      ['④', 'Stalled', '<p class="quiet" style="margin:0">Verification could not reach a conclusion. The account freezes and never advances on its own — "we couldn’t confirm" is never treated as evidence of death.</p>'],
      ['⑤', 'Hold', '<p class="quiet" style="margin:0">Three confirmations from three groups. A cancel window of up to 30 days begins. An operator can only <em>start</em> it — no one can skip or shorten it.</p>'],
      ['⑥', 'Private release', '<p class="quiet" style="margin:0">The window elapsed with no cancel. Your chosen people receive a gated link and a separate code, in the order you set.</p>'],
      ['⑦', 'Public release', '<p class="quiet" style="margin:0">Only if you turned it on. Fourteen days later, content is published to the destination you chose — the last chance to catch a wrong release.</p>'],
      ['⓿', 'Cancelled', '<p class="quiet" style="margin:0">Reachable from every state, unconditionally, with no point of no return. Wipes confirmations, resets timers, tells everyone it was a false alarm.</p>'],
    ],
  );
}

export function renderWhoItsForPage(): string {
  return docPage(
    'Who it’s for — Legacy Vault',
    'Who tends to keep a Legacy Vault, and why.',
    'Who it’s for',
    'For anyone with something that would go unsaid.',
    'The mechanics are the same for everyone; the reason differs. These are the people who most often set one up.',
    [
      ['—', 'Individuals & families', '<p class="quiet" style="margin:0">The messages, passwords, and instructions your family would spend months trying to reconstruct — set down once, released only if the worst happens.</p>'],
      ['—', 'Journalists & at-risk people', '<p class="quiet" style="margin:0">Material that should reach an editor or a trusted contact if you can no longer check in. Human verification and a hard cancel window mean it never fires on a bad week.</p>'],
      ['—', 'Business & operations', '<p class="quiet" style="margin:0">The continuity envelope — who to call, where the keys are, what only you know — handed over in an orderly way rather than lost with the bus factor.</p>'],
      ['—', 'Long-term custodians', '<p class="quiet" style="margin:0">Instructions for assets and accounts that must pass to the right person, paired with a plain reminder to name them in a will so the law backs the arrangement.</p>'],
    ],
  );
}

function planColumn(plan: Plan, featured: boolean): string {
  const bullets = plan.includes
    .map((b) => `<li style="margin:.4rem 0;padding-left:1.1rem;position:relative"><span style="position:absolute;left:0;color:var(--go)">·</span>${escapeHtml(b)}</li>`)
    .join('');
  const cta =
    plan.id === 'free'
      ? actionLink({ href: '/app', label: 'Start free', kind: 'ghost' })
      : actionLink({ href: `/app/billing?plan=${plan.id}`, label: `Choose ${plan.name}`, kind: featured ? 'go' : 'ghost' });
  return [
    `<div class="panel${featured ? ' panel--go' : ''}" style="display:flex;flex-direction:column">`,
    `<div class="eyebrow plain">${escapeHtml(plan.name)}</div>`,
    `<div class="serif" style="font-size:2rem;line-height:1">${escapeHtml(priceLabel(plan))}</div>`,
    `<p class="quiet" style="margin:.6rem 0 1rem;min-height:2.6em">${escapeHtml(plan.tagline)}</p>`,
    `<ul style="list-style:none;margin:0 0 1.4rem;padding:0;font-size:.92rem">${bullets}</ul>`,
    `<div style="margin-top:auto">${cta}</div>`,
    '</div>',
  ].join('');
}

export function renderPricingPage(): string {
  const plans = allPlans();
  const cols = plans.map((p) => planColumn(p, p.id === 'personal')).join('');
  return pub(
    'Pricing — Legacy Vault',
    'Legacy Vault plans: a free keepsake tier, and paid plans for more people, strict evidence mode, and public release.',
    [
      '<section class="wrap" style="padding:3.4rem 0">',
      eyebrow('Pricing'),
      '<h1>Pay for reach, never for safety.</h1>',
      '<p class="lede" style="max-width:44rem">Every plan — including the free one — has the full safety machinery: human verification, the cancel window, the no-login stop link, and the immutable log. Paid plans add more people, more storage, and the options that only make sense once you trust it.</p>',
      `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(15rem,1fr));gap:1rem;margin-top:2rem">${cols}</div>`,
      '<p class="quiet" style="margin-top:1.6rem;font-size:.88rem">Prices in USD, billed monthly, cancel anytime from the billing portal. A lapse or downgrade never deletes your content or changes a release you already configured — money decides only what you can newly set up.</p>',
      '</section>',
    ].join(''),
  );
}

export function renderSecurityPage(): string {
  return docPage(
    'Security & data — Legacy Vault',
    'How Legacy Vault stores content, who holds the keys, and the residual risk we state plainly.',
    'Security & data',
    'Honest about what we protect, and what we don’t claim.',
    'Security here is not a marketing surface. Below is what is true, including the parts most products would leave out.',
    [
      ['01', 'Everything is stored encrypted', '<p class="quiet" style="margin:0">Content is held as ciphertext under envelope encryption. No message body, URL, or access code is ever written to the audit log — the log keeps metadata only.</p>'],
      ['02', 'We hold the keys in V1 — stated, not hidden', '<p class="quiet" style="margin:0">This is not end-to-end encryption, and we don’t claim it is. Our team can decrypt to release. The accepted trade-off buys human verification and recovery; you should know it before you trust us.</p>'],
      ['03', 'Nothing sensitive travels in a channel', '<p class="quiet" style="margin:0">Recipients get a link by email and a code by text, on separate channels. An email carries no code; a text carries no link; a call carries neither. The message shapes make it structural, not a policy we remember.</p>'],
      ['04', 'Recovery is deliberately manual', '<p class="quiet" style="margin:0">There is no self-serve password reset. A person verifies your identity — slower on purpose, so no attacker can reset their way in and force a release.</p>'],
      ['05', 'Every action is logged immutably', '<p class="quiet" style="margin:0">Who viewed a contact, who recorded a confirmation, every state change — appended to a tamper-evident trail, forever, and never containing your content.</p>'],
    ],
  );
}
