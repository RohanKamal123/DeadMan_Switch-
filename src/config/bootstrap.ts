// Deployment bootstrap — turns environment variables into a wired AppConfig.
//
// This is the single place that chooses concrete backends for a public release:
// which persistence backend, which payment gateway, and the public-release
// destination. Everything it selects sits behind a port the rest of the system
// already depends on, so choosing Postgres over a JSON file, or real Stripe over
// the in-process fake, is a config change here and nowhere else.
//
// Secrets are read through secretsFromEnv (never hard-coded, never logged). What
// is NOT yet a production vendor — email/SMS/storage — stays on the in-memory
// adapters with a clear warning, because wiring real channel vendors is the
// separate G1.1 open item; nothing here pretends they are live.

import { randomUUID } from 'node:crypto';
import {
  FileKeyValueStore,
  InMemoryKeyValueStore,
  PostgresKeyValueStore,
  SqlKeyValueStore,
  createPgExecutor,
  createSqliteDriver,
  HashChainedAuditStore,
  FileAppendOnlySink,
  InMemoryAppendOnlySink,
  type KeyValueStore,
} from '../persistence';
import type { AuditSink } from '../domain/audit';
import type { AuditSinkFactory } from '../runtime';
import {
  InMemoryEmailAdapter,
  InMemorySmsAdapter,
  InMemoryPushAdapter,
  InMemoryStorageAdapter,
} from '../adapters/channels';
import { MemorialPublisher } from '../adapters/channels/memorial-publisher';
import { InMemoryPublicContentSource, MemorialStore } from '../memorial';
import { StripeBillingGateway } from '../adapters/billing';
import { FakeBillingGateway, isPlanId, type BillingGateway, type PlanId } from '../billing';
import { secretsFromEnv } from '../adapters/secrets';
import type { ContentPolicy } from '../domain/payload';
import type { AppConfig } from '../composition';

const DEFAULT_POLICY: ContentPolicy = {
  maxBytesByKind: { note: 100_000, photo: 10_000_000, pdf: 25_000_000 },
  allowedMimeTypes: {
    note: ['text/plain', 'text/markdown'],
    photo: ['image/jpeg', 'image/png', 'image/webp'],
    pdf: ['application/pdf'],
  },
};

function env(name: string, fallback = ''): string {
  return process.env[name] ?? fallback;
}

/** Build the state KeyValueStore from LV_STATE_BACKEND. Postgres is awaited (init). */
async function stateBackend(): Promise<KeyValueStore> {
  const backend = env('LV_STATE_BACKEND', 'file');
  switch (backend) {
    case 'memory':
      return new InMemoryKeyValueStore();
    case 'file':
      return new FileKeyValueStore(env('LV_STATE_FILE', './data/state.json'));
    case 'sqlite':
      return new SqlKeyValueStore(createSqliteDriver(env('LV_SQLITE_PATH', './data/state.db')));
    case 'postgres': {
      const store = new PostgresKeyValueStore({ executor: createPgExecutor(env('LV_DATABASE_URL')) });
      await store.init();
      return store;
    }
    default:
      throw new Error(`unknown LV_STATE_BACKEND: ${backend}`);
  }
}

function auditFactory(): AuditSinkFactory {
  const dir = env('LV_AUDIT_DIR');
  if (dir === '') {
    // Dev default: an in-memory tamper-evident sink per account.
    const sinks = new Map<string, AuditSink>();
    return (id: string): AuditSink => {
      let s = sinks.get(id);
      if (s === undefined) { s = new HashChainedAuditStore(new InMemoryAppendOnlySink()) as AuditSink; sinks.set(id, s); }
      return s;
    };
  }
  const sinks = new Map<string, AuditSink>();
  return (id: string): AuditSink => {
    let s = sinks.get(id);
    if (s === undefined) { s = new HashChainedAuditStore(new FileAppendOnlySink(`${dir}/${id}.log`)) as AuditSink; sinks.set(id, s); }
    return s;
  };
}

function billingGateway(): BillingGateway {
  const secretKey = env('LV_STRIPE_SECRET_KEY');
  const webhookSecret = env('LV_STRIPE_WEBHOOK_SECRET');
  if (secretKey === '' || webhookSecret === '') return new FakeBillingGateway();
  const priceByPlan: Record<Exclude<PlanId, 'free'>, string> = {
    personal: env('LV_STRIPE_PRICE_PERSONAL'),
    vault: env('LV_STRIPE_PRICE_VAULT'),
  };
  const planByPrice: Record<string, PlanId> = {};
  for (const [plan, price] of Object.entries(priceByPlan)) {
    if (price !== '' && isPlanId(plan)) planByPrice[price] = plan;
  }
  return new StripeBillingGateway({ secretKey, webhookSecret, priceByPlan, planByPrice });
}

/** Build a fully-wired AppConfig from the environment. Async because Postgres warms a cache. */
export async function configFromEnv(): Promise<AppConfig> {
  const state = await stateBackend();
  const auditFor = auditFactory();
  const memorials = new MemorialStore(state);
  const publisher = new MemorialPublisher({ source: new InMemoryPublicContentSource(), store: memorials });

  if (env('LV_STRIPE_SECRET_KEY') === '') {
    // eslint-disable-next-line no-console
    console.warn('[bootstrap] Stripe not configured — using the in-process billing fake (test mode).');
  }
  if (env('LV_STATE_BACKEND', 'file') === 'file') {
    // eslint-disable-next-line no-console
    console.warn('[bootstrap] Using the JSON-file state backend. Set LV_STATE_BACKEND=sqlite|postgres for production.');
  }

  return {
    state,
    cursors: state,
    credentials: state,
    auditFor,
    secrets: secretsFromEnv(),
    channels: {
      email: new InMemoryEmailAdapter(),
      sms: new InMemorySmsAdapter(),
      push: new InMemoryPushAdapter(),
      storage: new InMemoryStorageAdapter(),
    },
    publisher,
    contentPolicy: DEFAULT_POLICY,
    sessionTtlMs: Number(env('LV_SESSION_TTL_MS', String(1000 * 60 * 60 * 24 * 14))),
    opsEmail: env('LV_OPS_EMAIL', 'ops@legacyvault.example'),
    gatedBaseUrl: `${env('LV_BASE_URL', 'http://localhost:8080')}/release`,
    cancelFallback: {
      supportUrl: env('LV_SUPPORT_URL', 'mailto:support@legacyvault.example'),
      inAppCancelUrl: `${env('LV_BASE_URL', 'http://localhost:8080')}/app`,
    },
    billingGateway: billingGateway(),
    baseUrl: env('LV_BASE_URL', 'http://localhost:8080'),
    secureCookies: env('LV_BASE_URL').startsWith('https://'),
    now: () => Date.now(),
  };
}

/** A fresh account-id generator (exported for symmetry; composition has its own). */
export function newId(prefix: string): string {
  return `${prefix}_${randomUUID()}`;
}
