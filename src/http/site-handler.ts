// The web router for the browser-facing surfaces. It serves the public site, the
// legal layer, the memorial destination, the user app, and the operator console
// as server-rendered HTML, and falls through to the JSON API for everything else.
// Reads render; state-changing POSTs check a CSRF token bound to the session
// cookie. Nothing here mutates directly — it calls the application-service tier,
// exactly like the JSON handlers.

import type { Authenticator } from './auth';
import type { LoginBackend } from './login-handler';
import type {
  AccountService,
  AuthoringService,
  LivenessService,
  OperatorService,
  PeopleService,
} from '../app';
import type { BillingService } from '../billing';
import { checkAddContact, checkAddRecipient, statusLabel, planById, isPlanId } from '../billing';
import type { Contact, Role } from '../console';
import { canRecordConfirmation } from '../console';
import type { Group, State } from '../domain/states';
import type { MachineRepository } from '../persistence';
import type { MemorialStore } from '../memorial';
import type { Principal } from '../app/principal';
import { html, type HttpRequest, type HttpResponse } from './message';
import {
  csrfToken,
  csrfValid,
  clearSessionCookie,
  redirect,
  sessionToken,
  setSessionCookie,
} from './app-session';
import {
  renderAppHome,
  renderAppLogin,
  renderBilling,
  renderContent,
  renderPeople,
  renderSettings,
  renderSignup,
} from './app-pages';
import { renderOperatorAccount, renderOperatorQueue, type OperatorContactRow, type QueueRow } from './operator-pages';
import {
  renderLandingPage,
  renderHowItWorksPage,
  renderPricingPage,
  renderSecurityPage,
  renderWhoItsForPage,
} from './marketing-pages';
import { LEGAL_PAGES } from './legal-pages';
import { renderMemorialNotFoundPage, renderMemorialPage } from './memorial-pages';
import type { BannerKind } from './design';

export interface SiteDeps {
  readonly authenticator: Authenticator;
  readonly auth: LoginBackend;
  readonly accounts: AccountService;
  readonly liveness: LivenessService;
  readonly people: PeopleService;
  readonly authoring: AuthoringService;
  readonly operators: OperatorService;
  readonly billing: BillingService;
  readonly machines: MachineRepository;
  readonly memorials: MemorialStore;
  readonly now: () => number;
  readonly baseUrl: string;
  readonly secureCookies: boolean;
  readonly newContactId: () => string;
  /** The next JSON API route to try when no HTML surface matches. */
  readonly apiFallback: (req: HttpRequest) => HttpResponse;
}

function form(req: HttpRequest): URLSearchParams {
  return new URLSearchParams(req.body ?? '');
}

function principalFor(deps: SiteDeps, req: HttpRequest): Principal | null {
  const token = sessionToken(req);
  if (token === undefined) return null;
  return deps.authenticator.authenticate(token);
}

const BANNERS: Record<State, { kind: BannerKind; title: string; sub: string; hold: boolean }> = {
  ACTIVE: { kind: 'ok', title: 'All good', sub: 'Your last signal was recorded. Check in weekly.', hold: false },
  NUDGE: { kind: 'watch', title: 'We haven’t heard from you', sub: 'We’ve contacted only you — no one else. Check in to reset everything.', hold: false },
  VERIFYING: { kind: 'watch', title: 'We’re looking into whether you’re okay', sub: 'Check in and it stops immediately. Nothing has been released.', hold: false },
  STALLED: { kind: 'watch', title: 'We couldn’t confirm anything', sub: 'Nothing will be released. This is not treated as evidence of anything. Please check in or contact us.', hold: false },
  HOLD: { kind: 'hold', title: 'A hold is running', sub: 'Nothing has been released. You can stop it at any second.', hold: true },
  PRIVATE_RELEASE: { kind: 'hold', title: 'Delivery has begun', sub: 'You can still stop everything. Tap below.', hold: true },
  PUBLIC_RELEASE: { kind: 'hold', title: 'Public release window', sub: 'You can still stop everything. Tap below.', hold: true },
  CANCELLED: { kind: 'ok', title: 'Everything’s stopped and reset', sub: 'We let anyone we’d contacted know it was a false alarm.', hold: false },
};

export function createSiteRoute(deps: SiteDeps): (req: HttpRequest) => HttpResponse | Promise<HttpResponse> {
  return (req: HttpRequest): HttpResponse | Promise<HttpResponse> => {
    try {
      return route(deps, req);
    } catch {
      return html(500, '<!doctype html><title>Error</title><p>Something went wrong.</p>');
    }
  };
}

function route(deps: SiteDeps, req: HttpRequest): HttpResponse | Promise<HttpResponse> {
  const path = req.path;
  const method = req.method;

  // --- public marketing ---
  if (method === 'GET') {
    if (path === '/' ) return html(200, renderLandingPage());
    if (path === '/how-it-works') return html(200, renderHowItWorksPage());
    if (path === '/who-its-for') return html(200, renderWhoItsForPage());
    if (path === '/pricing') return html(200, renderPricingPage());
    if (path === '/security') return html(200, renderSecurityPage());
    const legal = LEGAL_PAGES[path];
    if (legal !== undefined) return html(200, legal());
    if (path === '/signup') return html(200, renderSignup({}));
    if (path.startsWith('/memorial/')) return memorial(deps, path);
  }

  // --- user app ---
  if (path === '/app/login' || path === '/app/signup' || path === '/app/logout' || path.startsWith('/app')) {
    return appSurface(deps, req);
  }
  // --- operator console ---
  if (path === '/console' || path.startsWith('/console')) {
    return operatorSurface(deps, req);
  }

  return deps.apiFallback(req);
}

function memorial(deps: SiteDeps, path: string): HttpResponse {
  const handle = path.slice('/memorial/'.length);
  const doc = deps.memorials.get(handle);
  return html(doc === undefined ? 404 : 200, doc === undefined ? renderMemorialNotFoundPage() : renderMemorialPage(doc));
}

// ---------------------------------------------------------------------------
// User app
// ---------------------------------------------------------------------------

function appSurface(deps: SiteDeps, req: HttpRequest): HttpResponse | Promise<HttpResponse> {
  const { method, path } = req;

  if (path === '/app/login' && method === 'POST') return appLogin(deps, req);
  if (path === '/app/signup' && method === 'POST') return appSignup(deps, req);
  if (path === '/app/login' && method === 'GET') return html(200, renderAppLogin({ surface: 'app', signupHref: '/signup' }));

  const principal = principalFor(deps, req);
  if (principal === null || principal.kind !== 'user' || principal.accountId === undefined) {
    return html(200, renderAppLogin({ surface: 'app', signupHref: '/signup' }));
  }
  const accountId = principal.accountId;
  const token = sessionToken(req)!;
  const csrf = csrfToken(token);

  if (method === 'POST') {
    if (!csrfValid(token, form(req).get('csrf') ?? undefined)) return redirect('/app');
    if (path === '/app/logout') return redirect('/', clearSessionCookie(deps.secureCookies));
    if (path === '/app/check-in') {
      deps.liveness.checkIn(accountId, deps.now());
      return redirect('/app');
    }
    if (path === '/app/people/add') return appAddPerson(deps, req, accountId);
    if (path === '/app/billing/checkout') return appCheckout(deps, req, accountId);
    if (path === '/app/billing/portal') return appPortal(deps, accountId);
    return redirect('/app');
  }

  // GET app pages
  if (path === '/app' || path === '/app/') return html(200, appHome(deps, accountId, csrf, req));
  if (path === '/app/people') return html(200, appPeople(deps, accountId, csrf, req));
  if (path === '/app/content') return html(200, appContent(deps, accountId));
  if (path === '/app/settings') return html(200, appSettings(deps, accountId, csrf, principal));
  if (path === '/app/billing') return html(200, appBilling(deps, accountId, csrf, req));
  return html(404, renderAppLogin({ surface: 'app', signupHref: '/signup', error: 'Page not found.' }));
}

function appLogin(deps: SiteDeps, req: HttpRequest): HttpResponse {
  const body = form(req);
  const result = deps.auth.login(body.get('identifier') ?? '', body.get('password') ?? '', deps.now());
  if (!result.ok) return html(401, renderAppLogin({ surface: 'app', signupHref: '/signup', error: 'Those details didn’t match.' }));
  return redirect('/app', setSessionCookie(result.token, deps.secureCookies));
}

function appSignup(deps: SiteDeps, req: HttpRequest): HttpResponse {
  const body = form(req);
  const email = body.get('email') ?? '';
  if (body.get('agree') !== 'on') return html(400, renderSignup({ email, error: 'Please confirm you’ve read the terms.' }));
  const result = deps.accounts.signup(
    {
      email,
      password: body.get('password') ?? '',
      evidenceMode: body.get('evidence') === 'strict' ? 'strict' : 'lenient',
      publicReleaseEnabled: body.get('public') === 'on',
    },
    deps.now(),
  );
  if (!result.ok) return html(400, renderSignup({ email, error: result.reason }));
  return redirect('/app', setSessionCookie(result.token, deps.secureCookies));
}

function appHome(deps: SiteDeps, accountId: string, csrf: string, req: HttpRequest): string {
  const ctx = deps.machines.getContext(accountId);
  const state: State = ctx?.state ?? 'ACTIVE';
  const b = BANNERS[state];
  const plan = deps.billing.subscription(accountId);
  return renderAppHome({
    csrf,
    bannerKind: b.kind,
    bannerTitle: b.title,
    bannerSub: b.sub,
    checkInHint: 'Resets every timer. Next check-in due in 7 days.',
    planName: planById(plan.planId).name,
    holdRunning: b.hold,
    ...(req.query['ok'] === '1' ? { notice: 'Thanks — clock reset.' } : {}),
  });
}

function appPeople(deps: SiteDeps, accountId: string, csrf: string, req: HttpRequest): string {
  const contacts = deps.people.listContacts(accountId);
  const order = deps.people.getRecipientOrder(accountId);
  const byId = new Map(contacts.map((c) => [c.id, c.name] as const));
  const state = deps.machines.getContext(accountId)?.state ?? 'ACTIVE';
  const frozen = state === 'HOLD' || state === 'PRIVATE_RELEASE' || state === 'PUBLIC_RELEASE';
  return renderPeople({
    csrf,
    contacts,
    recipientOrderNames: order.map((id) => byId.get(id) ?? id),
    contactCount: contacts.length,
    recipientCount: contacts.filter((c) => c.roles.includes('recipient')).length,
    ent: deps.billing.entitlements(accountId),
    frozen,
    ...(req.query['err'] !== undefined ? { notice: decodeURIComponent(req.query['err']) } : {}),
  });
}

function appAddPerson(deps: SiteDeps, req: HttpRequest, accountId: string): HttpResponse {
  const body = form(req);
  const name = (body.get('name') ?? '').trim();
  if (name === '') return redirect('/app/people?err=' + encodeURIComponent('A name is required.'));
  const roles: Role[] = [];
  if (body.get('confirmer') === 'on') roles.push('confirmer');
  if (body.get('recipient') === 'on') roles.push('recipient');
  if (roles.length === 0) roles.push('confirmer');

  const contacts = deps.people.listContacts(accountId);
  const ent = deps.billing.entitlements(accountId);
  const contactGate = checkAddContact(contacts.length, ent);
  if (!contactGate.ok) return redirect('/app/people?err=' + encodeURIComponent(contactGate.reason));
  if (roles.includes('recipient')) {
    const recipientGate = checkAddRecipient(contacts.filter((c) => c.roles.includes('recipient')).length, ent);
    if (!recipientGate.ok) return redirect('/app/people?err=' + encodeURIComponent(recipientGate.reason));
  }

  const contact: Contact = {
    id: deps.newContactId(),
    name,
    group: (body.get('group') ?? 'other') as Group,
    roles,
    email: (body.get('email') ?? '').trim() || null,
    phone: (body.get('phone') ?? '').trim() || null,
    consentAt: null,
    stale: false,
  };
  const result = deps.people.addContact(accountId, contact);
  if (!result.ok) return redirect('/app/people?err=' + encodeURIComponent(result.reason));
  return redirect('/app/people');
}

function appContent(deps: SiteDeps, accountId: string): string {
  const state = deps.machines.getContext(accountId)?.state ?? 'ACTIVE';
  const frozen = state === 'HOLD' || state === 'PRIVATE_RELEASE' || state === 'PUBLIC_RELEASE';
  return renderContent({ items: deps.authoring.listContent(accountId), frozen });
}

function appSettings(deps: SiteDeps, accountId: string, csrf: string, principal: Principal): string {
  const account = deps.accounts.get(accountId);
  const sub = deps.billing.subscription(accountId);
  return renderSettings({
    csrf,
    accountRef: principal.id,
    evidenceMode: account?.evidenceMode ?? 'lenient',
    publicReleaseEnabled: account?.publicReleaseEnabled ?? false,
    planName: planById(sub.planId).name,
    statusLine: statusLabel(sub),
  });
}

function appBilling(deps: SiteDeps, accountId: string, csrf: string, req: HttpRequest): string {
  const sub = deps.billing.subscription(accountId);
  return renderBilling({
    csrf,
    currentPlanId: sub.planId,
    statusLine: statusLabel(sub),
    hasCustomer: sub.customerId !== undefined,
    ...(req.query['ok'] === '1' ? { notice: 'Your plan is being updated — it will refresh once payment confirms.' } : {}),
  });
}

async function appCheckout(deps: SiteDeps, req: HttpRequest, accountId: string): Promise<HttpResponse> {
  const planId = form(req).get('plan') ?? '';
  if (!isPlanId(planId)) return redirect('/app/billing');
  const result = await deps.billing.startCheckout(accountId, planId, {
    successUrl: `${deps.baseUrl}/app/billing?ok=1`,
    cancelUrl: `${deps.baseUrl}/app/billing`,
  });
  if (!result.ok) return redirect('/app/billing');
  return redirect(result.value);
}

async function appPortal(deps: SiteDeps, accountId: string): Promise<HttpResponse> {
  const result = await deps.billing.openPortal(accountId, `${deps.baseUrl}/app/billing`);
  if (!result.ok) return redirect('/app/billing');
  return redirect(result.value);
}

// ---------------------------------------------------------------------------
// Operator console
// ---------------------------------------------------------------------------

function operatorSurface(deps: SiteDeps, req: HttpRequest): HttpResponse {
  const { method, path } = req;
  if (path === '/console/login' && method === 'GET') return html(200, renderAppLogin({ surface: 'operator' }));
  if (path === '/console/login' && method === 'POST') {
    const body = form(req);
    const result = deps.auth.login(body.get('identifier') ?? '', body.get('password') ?? '', deps.now());
    if (!result.ok) return html(401, renderAppLogin({ surface: 'operator', error: 'Those details didn’t match.' }));
    return redirect('/console', setSessionCookie(result.token, deps.secureCookies));
  }

  const principal = principalFor(deps, req);
  if (principal === null || principal.kind !== 'operator') {
    return html(200, renderAppLogin({ surface: 'operator' }));
  }
  const token = sessionToken(req)!;
  const csrf = csrfToken(token);
  const operatorId = principal.id;

  if (method === 'POST') {
    if (!csrfValid(token, form(req).get('csrf') ?? undefined)) return redirect('/console');
    return operatorAction(deps, req, operatorId);
  }

  if (path === '/console' || path === '/console/') return html(200, operatorQueue(deps));
  if (path === '/console/account') {
    const id = req.query['id'];
    if (id === undefined) return redirect('/console');
    return html(200, operatorAccount(deps, id, csrf));
  }
  return html(200, operatorQueue(deps));
}

function operatorQueue(deps: SiteDeps): string {
  const rows: QueueRow[] = [];
  for (const accountId of deps.machines.ids()) {
    const ctx = deps.machines.getContext(accountId);
    if (ctx === undefined) continue;
    if (ctx.state === 'VERIFYING' || ctx.state === 'STALLED' || ctx.state === 'HOLD') {
      rows.push({ accountId, state: ctx.state, waitingLabel: ctx.state === 'VERIFYING' ? 'awaiting confirmations' : ctx.state === 'HOLD' ? 'cancel window running' : 'verification exhausted' });
    }
  }
  return renderOperatorQueue({ rows });
}

function operatorAccount(deps: SiteDeps, accountId: string, csrf: string): string {
  const snapshot = deps.operators.snapshot(accountId);
  if (snapshot === undefined) return renderOperatorQueue({ rows: [] });
  const contacts = deps.people.listContacts(accountId);
  const confirmedIds = new Set(snapshot.quorum.groups.flatMap((g) => g.contactIds));
  const rows: OperatorContactRow[] = contacts.map((c) => {
    const eligibility = canRecordConfirmation(c);
    return {
      contact: c,
      canConfirm: eligibility.ok,
      confirmReason: eligibility.reason,
      hasConfirmed: confirmedIds.has(c.id),
    };
  });
  return renderOperatorAccount({
    csrf,
    accountId,
    state: snapshot.state,
    contacts: rows,
    quorum: snapshot.quorum,
    holdReadiness: snapshot.holdReadiness,
  });
}

function operatorAction(deps: SiteDeps, req: HttpRequest, operatorId: string): HttpResponse {
  const body = form(req);
  const accountId = body.get('accountId') ?? '';
  const contactId = body.get('contactId') ?? '';
  const now = deps.now();
  const back = redirect('/console/account?id=' + encodeURIComponent(accountId));
  switch (req.path) {
    case '/console/confirm':
      deps.operators.recordConfirmation(accountId, contactId, operatorId, now);
      return back;
    case '/console/withdraw':
      deps.operators.recordWithdrawal(accountId, contactId, operatorId, now);
      return back;
    case '/console/start-hold':
      deps.operators.startHold(accountId, operatorId, now);
      return back;
    default:
      return redirect('/console');
  }
}
