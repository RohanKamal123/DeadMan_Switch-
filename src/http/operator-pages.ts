// The operator console surface (UX_SPEC.md §3). Its whole job is to make the
// careful path the easy path and the dangerous path structurally impossible:
// contacts are shown one at a time (never a bulk grid that invites rushed batch
// judgment), the quorum meter shows distinct GROUPS rather than a raw count, and
// Start-HOLD stays disabled — with its reasons spelled out — until three
// confirmations from three groups are recorded. There is no control anywhere to
// skip or shorten the cancel window, because none exists.

import { page, eyebrow, escapeHtml, chip } from './design';
import type { Contact } from '../console';
import type { HoldReadinessView, QuorumMeterView } from '../console';
import type { State } from '../domain/states';

function hidden(csrf: string, extra: Record<string, string> = {}): string {
  const fields = Object.entries(extra)
    .map(([k, v]) => `<input type="hidden" name="${escapeHtml(k)}" value="${escapeHtml(v)}">`)
    .join('');
  return `<input type="hidden" name="csrf" value="${escapeHtml(csrf)}">${fields}`;
}

function stateChip(state: State): string {
  const kind = state === 'CANCELLED' || state === 'ACTIVE' ? 'go' : state === 'HOLD' || state === 'STALLED' ? 'hold' : undefined;
  return chip(state, kind);
}

export interface QueueRow {
  readonly accountId: string;
  readonly state: State;
  readonly waitingLabel: string;
}

export function renderOperatorQueue(vm: { rows: readonly QueueRow[] }): string {
  const rows = vm.rows.length === 0
    ? '<tr><td colspan="3" class="quiet">The queue is empty. Nothing has reached day 30 unresponsive.</td></tr>'
    : vm.rows
        .map(
          (r) =>
            `<tr><td><a href="/console/account?id=${encodeURIComponent(r.accountId)}"><span class="num">${escapeHtml(r.accountId)}</span></a></td><td>${stateChip(r.state)}</td><td class="quiet">${escapeHtml(r.waitingLabel)}</td></tr>`,
        )
        .join('');
  return page(
    { surface: 'operator', title: 'Operator queue — Legacy Vault' },
    [
      '<section class="wrap" style="padding:2.4rem 0;max-width:52rem">',
      eyebrow('Operator queue'),
      '<h1>Verification queue</h1>',
      '<p class="quiet">Accounts that reached day 30 unresponsive. This is a worklist, not a countdown — nothing here is urgent to release. Never begin outreach on a broken notification stack; if a dependency is unhealthy the account view will block Start-HOLD and say why.</p>',
      `<table class="ledger" style="margin-top:1.2rem"><caption>Awaiting verification</caption><thead><tr><th>Account</th><th>State</th><th>Waiting</th></tr></thead><tbody>${rows}</tbody></table>`,
      '</section>',
    ].join(''),
  );
}

export interface OperatorContactRow {
  readonly contact: Contact;
  readonly canConfirm: boolean;
  readonly confirmReason: string | null;
  readonly hasConfirmed: boolean;
}

export interface OperatorAccountViewModel {
  readonly csrf: string;
  readonly accountId: string;
  readonly state: State;
  readonly contacts: readonly OperatorContactRow[];
  readonly quorum: QuorumMeterView;
  readonly holdReadiness: HoldReadinessView;
  readonly notice?: string;
}

function quorumMeter(q: QuorumMeterView): string {
  const pips = q.groups
    .map(
      (g) =>
        `<div class="group-pip${g.confirmed ? ' met' : ''}"><div class="g">${escapeHtml(g.group)}</div><div class="v">${g.confirmed ? '✓ confirmed' : '—'}</div></div>`,
    )
    .join('');
  return [
    '<div class="panel">',
    '<div class="eyebrow plain">Quorum — three distinct groups</div>',
    `<div class="groups">${pips}</div>`,
    `<p class="quiet" style="margin:.4rem 0 0">${q.distinctGroups} of ${q.requiredGroups} groups. ${q.met ? 'Quorum met.' : `Two confirmations from the same group still count as one.`}</p>`,
    '</div>',
  ].join('');
}

function contactCard(vm: OperatorAccountViewModel, row: OperatorContactRow): string {
  const c = row.contact;
  const reach = [c.email, c.phone].filter((x) => x !== null).join(' · ');
  const consent = c.consentAt !== null ? chip('consented', 'go') : chip('no consent', 'pending');
  const confirmed = row.hasConfirmed ? ' ' + chip('confirmed', 'go') : '';
  const action = row.hasConfirmed
    ? `<form method="post" action="/console/withdraw" style="margin-top:.6rem">${hidden(vm.csrf, { accountId: vm.accountId, contactId: c.id })}<button class="act act--ghost" type="submit">Record withdrawal</button></form>`
    : row.canConfirm
      ? `<form method="post" action="/console/confirm" style="margin-top:.6rem">${hidden(vm.csrf, { accountId: vm.accountId, contactId: c.id })}<button class="act act--go" type="submit">Record confirmation</button></form>`
      : `<p class="quiet" style="margin:.6rem 0 0;font-size:.85rem">Can’t record a confirmation: ${escapeHtml(row.confirmReason ?? 'not eligible')}.</p>`;
  return [
    '<div class="panel panel--raise" style="margin-bottom:.8rem">',
    `<div style="display:flex;justify-content:space-between;gap:1rem;align-items:baseline"><strong>${escapeHtml(c.name)}</strong>${chip(c.group)}</div>`,
    `<div class="quiet" style="font-size:.9rem;margin:.2rem 0">${escapeHtml(reach)}</div>`,
    `<div class="tag-row">${consent}${confirmed}${c.stale ? ' ' + chip('details stale', 'hold') : ''}</div>`,
    '<div class="banner banner--watch" style="margin:.7rem 0"><span class="dot"></span><div><p class="s" style="margin:0">You may explain the situation. You must never read out a link, a code, or any content. Your actions here are recorded.</p></div></div>',
    action,
    '</div>',
  ].join('');
}

export function renderOperatorAccount(vm: OperatorAccountViewModel): string {
  const holdBtn = vm.holdReadiness.canStart
    ? `<form method="post" action="/console/start-hold">${hidden(vm.csrf, { accountId: vm.accountId })}<button class="act act--go" type="submit">Start the hold</button></form>`
    : `<span class="act act--go is-disabled">Start the hold</span><ul class="quiet" style="margin:.6rem 0 0;font-size:.85rem">${vm.holdReadiness.reasons.map((r) => `<li>${escapeHtml(r)}</li>`).join('')}</ul>`;
  const contactCards = vm.contacts.length === 0
    ? '<p class="quiet">No contacts on this account.</p>'
    : vm.contacts.map((row) => contactCard(vm, row)).join('');
  const notice = vm.notice === undefined ? '' : `<div class="panel panel--go" role="status" style="margin:1rem 0"><p style="margin:0">${escapeHtml(vm.notice)}</p></div>`;
  return page(
    { surface: 'operator', title: `Account ${vm.accountId} — Operator console` },
    [
      '<section class="wrap" style="padding:2.4rem 0;max-width:48rem">',
      eyebrow('Account · verification'),
      `<div style="display:flex;justify-content:space-between;align-items:baseline;gap:1rem"><h1 style="margin:0"><span class="num" style="font-size:1.4rem">${escapeHtml(vm.accountId)}</span></h1>${stateChip(vm.state)}</div>`,
      notice,
      quorumMeter(vm.quorum),
      '<div class="panel panel--hold" style="margin:1rem 0"><p style="margin:0"><strong>Starting a hold is your only power here.</strong> You cannot skip it, shorten it, or release early — that is the code’s job, not yours.</p>' + '<div style="margin-top:.8rem">' + holdBtn + '</div></div>',
      '<h2 style="font-size:1.2rem">Contacts, one at a time</h2>',
      contactCards,
      `<p class="quiet" style="margin-top:1rem;font-size:.85rem"><a href="/console/audit?id=${encodeURIComponent(vm.accountId)}">View the immutable audit trail</a> — read-only, metadata only.</p>`,
      '</section>',
    ].join(''),
  );
}
