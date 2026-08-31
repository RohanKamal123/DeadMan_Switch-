// Composition root — wires the whole system together (DECISIONS_PHASE_F_G.md).
//
// This is the ONLY place that knows about every tier at once: it builds the
// repositories, the vendor adapters, the crypto, the auth, and the application
// services, then exposes them behind two servers:
//   - the CANCEL server, deliberately separate (its own failure domain, F1.4);
//   - the MAIN API server, routing the four audiences to their handlers.
//
// Every handler still calls only the application-service tier, which is the only
// tier that mutates — no surface writes state. Secrets are injected (G4); nothing
// here is hard-coded.

import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { EnvelopeCrypto, LocalKeyWrapper } from './adapters/crypto';
import { CredentialStore, SessionAuthenticator, AuthService } from './adapters/auth';
import type { Channels, PublicPublisher } from './adapters/channels';
import type { Secrets } from './adapters/secrets';
import {
  AccountService,
  AdminService,
  AuthoringService,
  CancelService,
  DrillService,
  LivenessService,
  OperatorService,
  PeopleService,
  PublicReleaseService,
  ReleaseService,
} from './app';
import { BillingService, FakeBillingGateway, SubscriptionRepository, type BillingGateway } from './billing';
import { MemorialStore } from './memorial';
import type { ContentPolicy } from './domain/payload';
import {
  AccountRepository,
  CaseFileRepository,
  ContactRepository,
  DeliveryRepository,
  MachineRepository,
  PayloadRepository,
  RecipientOrderRepository,
  ReleasePlanRepository,
  type KeyValueStore,
} from './persistence';
import type { AuditSinkFactory } from './runtime';
import {
  createCancelServer,
  createNodeServer,
  createSiteRoute,
  handleAdmin,
  handleCheckIn,
  handleLogin,
  handleOperator,
  handleRecipient,
  handleUser,
  json,
  type CancelFallback,
  type HttpRequest,
  type HttpResponse,
  type RequestMetrics,
  type Route,
} from './http';
import * as http from 'node:http';

export interface AppConfig {
  /** State KV backend (in-memory for dev, JSON file for production). */
  readonly state: KeyValueStore;
  /** Scheduler cursor backend. */
  readonly cursors: KeyValueStore;
  /** Credential backend. */
  readonly credentials: KeyValueStore;
  /** Durable, per-account audit sink factory (invariant 7). */
  readonly auditFor: AuditSinkFactory;
  readonly secrets: Secrets;
  readonly channels: Channels;
  readonly publisher: PublicPublisher;
  readonly contentPolicy: ContentPolicy;
  readonly sessionTtlMs: number;
  readonly opsEmail: string;
  /** Base URL the recipient gated link is built on. */
  readonly gatedBaseUrl: string;
  /** Support / in-app-cancel links shown on the cancel fail-safe page. */
  readonly cancelFallback: CancelFallback;
  /** Payment gateway. Defaults to an in-process fake (test-mode) when omitted. */
  readonly billingGateway?: BillingGateway;
  /** Absolute base URL for building billing return links. Defaults to ''. */
  readonly baseUrl?: string;
  /** Set-Cookie `Secure` attribute on session cookies. Defaults to true. */
  readonly secureCookies?: boolean;
  readonly now: () => number;
}

export interface Services {
  readonly cancel: CancelService;
  readonly liveness: LivenessService;
  readonly operators: OperatorService;
  readonly release: ReleaseService;
  readonly people: PeopleService;
  readonly authoring: AuthoringService;
  readonly admin: AdminService;
  readonly drill: DrillService;
  readonly publicRelease: PublicReleaseService;
  readonly accounts: AccountService;
  readonly billing: BillingService;
  readonly memorials: MemorialStore;
  readonly auth: AuthService;
  readonly authenticator: SessionAuthenticator;
  readonly crypto: EnvelopeCrypto;
}

export function buildServices(config: AppConfig): Services {
  const machines = new MachineRepository(config.state);
  const contacts = new ContactRepository(config.state);
  const payloads = new PayloadRepository(config.state);
  const caseFiles = new CaseFileRepository(config.state);
  const plans = new ReleasePlanRepository(config.state);
  const deliveries = new DeliveryRepository(config.state);
  const recipientOrders = new RecipientOrderRepository(config.state);
  const { auditFor, secrets, channels } = config;

  const crypto = new EnvelopeCrypto(new LocalKeyWrapper({ keyId: 'kms-primary', masterKey: secrets.kmsMasterKey }));

  // Crypto-secure generators for the recipient release capability tokens. The
  // gated link + one-time code are the ONLY thing standing between an attacker
  // and a deceased user's private content, so they must not use Math.random
  // (CWE-338). A 6-digit code (kept human-enterable) is paired with a 256-bit
  // link token; deployment adds the F4.1 attempt cap.
  const codeGenerator = (): string => String(randomInt(0, 1_000_000)).padStart(6, '0');
  const linkGenerator = (): string => `gl_${randomBytes(32).toString('base64url')}`;
  const releaseArgs = { machines, contacts, payloads, plans, deliveries, auditFor, codeGenerator, linkGenerator };
  const credentialStore = new CredentialStore(config.credentials);
  const authenticator = new SessionAuthenticator({ secret: secrets.sessionSecret, now: config.now });
  const auth = new AuthService({ credentials: credentialStore, sessionSecret: secrets.sessionSecret, sessionTtlMs: config.sessionTtlMs, auditFor });

  const accountsRepo = new AccountRepository(config.state);
  const accounts = new AccountService({ accounts: accountsRepo, machines, auth, auditFor, newAccountId: () => `acct_${randomUUID()}` });
  const subscriptions = new SubscriptionRepository(config.state);
  const billing = new BillingService({ subscriptions, gateway: config.billingGateway ?? new FakeBillingGateway(), auditFor, now: config.now });
  const memorials = new MemorialStore(config.state);

  return {
    cancel: new CancelService({ machines, auditFor, secret: secrets.cancelTokenSecrets }),
    liveness: new LivenessService({ machines, auditFor }),
    operators: new OperatorService({ machines, contacts, caseFiles, auditFor }),
    release: new ReleaseService(releaseArgs),
    people: new PeopleService({ contacts, machines, recipientOrders }),
    authoring: new AuthoringService({ payloads, contacts, machines, policy: config.contentPolicy }),
    admin: new AdminService({ machines, auditFor, release: new ReleaseService(releaseArgs) }),
    drill: new DrillService({ contacts, email: channels.email, sms: channels.sms, auditFor }),
    publicRelease: new PublicReleaseService({ machines, publisher: config.publisher, auditFor }),
    accounts,
    billing,
    memorials,
    auth,
    authenticator,
    crypto,
  };
}

/** The main API route: dispatch a request to the handler for its audience. */
export function apiRoute(services: Services, now: () => number): Route {
  const { authenticator } = services;
  return (req: HttpRequest): HttpResponse => {
    const path = req.path;
    if (path === '/auth/login') return handleLogin(req, { auth: services.auth, now });
    if (path === '/billing/webhook') {
      if (req.method !== 'POST') return json(404, { error: 'not found' });
      const outcome = services.billing.applyWebhook(req.body, req.headers?.['stripe-signature']);
      return json(outcome.status, { received: outcome.handled });
    }
    if (path === '/check-in') return handleCheckIn(req, { authenticator, liveness: services.liveness, now });
    if (path.startsWith('/operator/')) return handleOperator(req, { authenticator, operators: services.operators, now });
    if (path === '/release' || path === '/release/resend') return handleRecipient(req, { release: services.release, now });
    if (path.startsWith('/me/')) return handleUser(req, { authenticator, people: services.people, authoring: services.authoring, now });
    if (path.startsWith('/admin/')) return handleAdmin(req, { authenticator, admin: services.admin, now });
    return { status: 404, headers: { 'content-type': 'application/json; charset=utf-8' }, body: JSON.stringify({ error: 'not found' }) };
  };
}

/**
 * The web route for the browser-facing surfaces (public site, legal, memorials,
 * user app, operator console), falling through to the JSON API. This is what the
 * main server serves, so every existing JSON endpoint still works unchanged —
 * the site route only intercepts the HTML surfaces.
 */
export function webRoute(services: Services, config: AppConfig): (req: HttpRequest) => HttpResponse | Promise<HttpResponse> {
  const api = apiRoute(services, config.now);
  return createSiteRoute({
    authenticator: services.authenticator,
    auth: services.auth,
    accounts: services.accounts,
    liveness: services.liveness,
    people: services.people,
    authoring: services.authoring,
    operators: services.operators,
    billing: services.billing,
    machines: new MachineRepository(config.state),
    memorials: services.memorials,
    now: config.now,
    baseUrl: config.baseUrl ?? '',
    secureCookies: config.secureCookies ?? true,
    newContactId: () => `ct_${randomUUID()}`,
    apiFallback: api,
  });
}

export interface Servers {
  readonly cancelServer: http.Server;
  readonly apiServer: http.Server;
  readonly services: Services;
}

/**
 * Build both servers. The cancel server is separate so it can be deployed in its
 * own failure domain (F1.4). Neither is started — call `.listen(...)`.
 */
export function createServers(config: AppConfig, metrics?: RequestMetrics): Servers {
  const services = buildServices(config);
  const cancelDeps = { service: services.cancel, fallback: config.cancelFallback, now: config.now };
  const cancelServer = createCancelServer(cancelDeps, metrics === undefined ? {} : { metrics });
  const apiServer = createNodeServer(webRoute(services, config));
  return { cancelServer, apiServer, services };
}
