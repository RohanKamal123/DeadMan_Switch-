// Deployment bootstrap — turns environment variables into a wired AppConfig.
//
// This is the single place that chooses concrete backends and vendors for a
// public release: persistence, payment gateway, public-release destination, the
// KMS provider (G2.1), the channel vendors (G1.1), and the deployment policy
// numbers (content sizes, G5/11.5; the recipient access cap, F4.1). Everything it
// selects sits behind a port the rest of the system already depends on, so
// choosing Postgres over a file, real Stripe over the fake, or a KMS over the
// local wrapper is a config change here and nowhere else.
//
// Two rules govern every selection below, both descended from "being wrong is
// worse than being slow":
//   1. A selection the operator names but that is NOT wired FAILS THE BOOT — it
//      never silently falls back to a dev stand-in. An operator who thinks SMS is
//      live, or that content is KMS-wrapped, must never be quietly running on the
//      in-memory adapter or the local key.
//   2. Numbers (byte limits, the attempt cap) are DEPLOYMENT config with
//      conservative defaults; they are never invented in the domain (CLAUDE.md).
//
// Secrets are read through secretsFromEnv (never hard-coded, never logged).

import { randomUUID } from 'node:crypto';
import type { KeyValueStore } from '../persistence';
import type { AuditSink } from '../domain/audit';
import type { AuditSinkFactory } from '../runtime';
import {
  InMemoryEmailAdapter,
  InMemorySmsAdapter,
  InMemoryPushAdapter,
  InMemoryStorageAdapter,
  createR2StorageAdapter,
  ResendEmailAdapter,
  TwilioSmsAdapter,
  type BlobStore,
  type Channels,
  type EmailPort,
  type SmsPort,
  type StoragePort,
} from '../adapters/channels';
import { LocalKeyWrapper, type KeyWrapper } from '../adapters/crypto';
import { MemorialPublisher } from '../adapters/channels/memorial-publisher';
import { InMemoryPublicContentSource, MemorialStore } from '../memorial';
import { StripeBillingGateway } from '../adapters/billing';
import { FakeBillingGateway, isPlanId, type BillingGateway, type PlanId } from '../billing';
import { secretsFromEnv, type Secrets } from '../adapters/secrets';
import type { ContentPolicy } from '../domain/payload';
import type { RecipientAccessPolicy } from '../delivery';
import type { AppConfig } from '../composition';
import { stateBackend, auditFactory } from './state';

// Baseline content limits (DECISIONS.md 11.5). These are DEPLOYMENT defaults, not
// domain constants — each is overridable per environment; the domain only ever
// enforces the number it is handed.
const DEFAULT_MAX_BYTES: Readonly<Record<'note' | 'photo' | 'pdf', number>> = {
  note: 100_000,
  photo: 10_000_000,
  pdf: 25_000_000,
};
const ALLOWED_MIME_TYPES: ContentPolicy['allowedMimeTypes'] = {
  note: ['text/plain', 'text/markdown'],
  photo: ['image/jpeg', 'image/png', 'image/webp'],
  pdf: ['application/pdf'],
};

// Deployment default for the recipient gated-page attempt cap (F4.1). "A small
// fixed number"; conservative and overridable. The domain enforces whatever cap
// this resolves to and no cap at all if it is disabled.
const DEFAULT_CODE_ATTEMPT_CAP = 5;

/** The launch jurisdiction (DECISIONS.md 1.1). A vendor storing data elsewhere is "cross-border". */
const DOMESTIC_REGIONS = new Set(['bd', 'bangladesh']);

export type ServerRole = 'combined' | 'api' | 'cancel';

function env(name: string, fallback = ''): string {
  return process.env[name] ?? fallback;
}

function truthy(value: string): boolean {
  return value === '1' || value.toLowerCase() === 'true' || value.toLowerCase() === 'yes';
}

/** Parse a positive-integer env override, or fall back. Rejects junk rather than guessing. */
function intEnv(name: string, fallback: number): number {
  const raw = env(name);
  if (raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`${name} must be a positive integer, got ${JSON.stringify(raw)}`);
  }
  return n;
}

/** Which server(s) this process runs (F1.5). Default is combined (dev / single-node). */
export function serverRole(e: NodeJS.ProcessEnv = process.env): ServerRole {
  const role = (e['LV_SERVER_ROLE'] ?? 'combined').toLowerCase();
  if (role === 'combined' || role === 'api' || role === 'cancel') return role;
  throw new Error(`unknown LV_SERVER_ROLE: ${role} (expected combined|api|cancel)`);
}

/** Content byte limits + allowed mime types (G5/11.5), with per-kind overrides. */
export function contentPolicyFromEnv(e: NodeJS.ProcessEnv = process.env): ContentPolicy {
  const cap = (name: string, kind: 'note' | 'photo' | 'pdf'): number => {
    const raw = e[name] ?? '';
    if (raw === '') return DEFAULT_MAX_BYTES[kind];
    const n = Number(raw);
    if (!Number.isInteger(n) || n <= 0) {
      throw new Error(`${name} must be a positive integer, got ${JSON.stringify(raw)}`);
    }
    return n;
  };
  return {
    maxBytesByKind: {
      note: cap('LV_MAX_NOTE_BYTES', 'note'),
      photo: cap('LV_MAX_PHOTO_BYTES', 'photo'),
      pdf: cap('LV_MAX_PDF_BYTES', 'pdf'),
    },
    allowedMimeTypes: ALLOWED_MIME_TYPES,
  };
}

/**
 * Recipient gated-page throttle (F4.1). `LV_RECIPIENT_CODE_ATTEMPT_CAP=off`
 * disables the cap explicitly (returns undefined → no lockout); any positive
 * integer sets it; empty uses the conservative default.
 */
export function recipientAccessPolicyFromEnv(
  e: NodeJS.ProcessEnv = process.env,
): RecipientAccessPolicy | undefined {
  const raw = e['LV_RECIPIENT_CODE_ATTEMPT_CAP'] ?? '';
  if (raw.toLowerCase() === 'off') return undefined;
  if (raw === '') return { codeAttemptCap: DEFAULT_CODE_ATTEMPT_CAP };
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`LV_RECIPIENT_CODE_ATTEMPT_CAP must be a positive integer or "off", got ${JSON.stringify(raw)}`);
  }
  return { codeAttemptCap: n };
}

/**
 * Select the KMS key wrapper (G2/G2.1). `local` (default) wraps with the injected
 * master key; a named external provider is refused until its adapter is wired,
 * so the operator is never silently running on the local key while believing a
 * managed KMS is in force. `LV_KMS_KEY_ID` names the wrapping key so rotation is
 * a config change (new key id + master key) with no envelope migration.
 */
export function keyWrapperFromEnv(secrets: Secrets, e: NodeJS.ProcessEnv = process.env): KeyWrapper {
  const provider = (e['LV_KMS_PROVIDER'] ?? 'local').toLowerCase();
  const keyId = e['LV_KMS_KEY_ID'] ?? 'kms-primary';
  if (provider === 'local') {
    return new LocalKeyWrapper({ keyId, masterKey: secrets.kmsMasterKey });
  }
  throw new Error(
    `LV_KMS_PROVIDER=${provider} is selected but no KMS adapter is wired (G2.1). ` +
      `A managed-KMS adapter implements KeyWrapper in src/adapters/crypto/; until it exists, ` +
      `the boot fails rather than silently fall back to the local key. Use LV_KMS_PROVIDER=local for dev.`,
  );
}

/**
 * The data-localization / cross-border gate (DECISIONS.md 1.1). When any real
 * vendor is selected, its data region must be declared; a region outside the
 * launch jurisdiction requires an explicit acknowledgement, so cross-border data
 * flow is a deliberate, recorded choice — never an accident of configuration.
 */
function assertVendorDataLocalization(namedProviders: readonly string[], e: NodeJS.ProcessEnv): void {
  if (namedProviders.length === 0) return; // only memory stand-ins selected
  const region = (e['LV_VENDOR_DATA_REGION'] ?? '').toLowerCase();
  if (region === '') {
    throw new Error(
      `a real vendor is selected (${namedProviders.join(', ')}) but LV_VENDOR_DATA_REGION is not set — ` +
        `declare where the vendor stores data (DECISIONS.md 1.1).`,
    );
  }
  if (!DOMESTIC_REGIONS.has(region) && !truthy(e['LV_VENDOR_CROSS_BORDER_ACK'] ?? '')) {
    throw new Error(
      `vendor data region "${region}" is outside the launch jurisdiction; set ` +
        `LV_VENDOR_CROSS_BORDER_ACK=1 to acknowledge cross-border data flow (DECISIONS.md 1.1).`,
    );
  }
}

/** Providers with a real, wired adapter, per channel. Everything else still fails the boot. */
const WIRED_PROVIDERS: Record<'email' | 'sms' | 'push' | 'storage', ReadonlySet<string>> = {
  email: new Set(['memory', 'resend']),
  sms: new Set(['memory', 'twilio']),
  push: new Set(['memory']),
  storage: new Set(['memory', 'r2']),
};

/** Reads a set of required env vars for a vendor, throwing with exactly what's missing. */
function requiredEnv(e: NodeJS.ProcessEnv, providerLabel: string, names: readonly string[]): Record<string, string> {
  const values: Record<string, string> = {};
  const missing: string[] = [];
  for (const name of names) {
    const v = e[name] ?? '';
    if (v === '') missing.push(name);
    values[name] = v;
  }
  if (missing.length > 0) {
    throw new Error(`${providerLabel} requires ${missing.join(', ')}.`);
  }
  return values;
}

/** Reads and validates the R2 credential env vars. Throws with exactly what's missing. */
function r2OptionsFromEnv(e: NodeJS.ProcessEnv): { accountId: string; accessKeyId: string; secretAccessKey: string; bucket: string; endpoint?: string } {
  const v = requiredEnv(e, 'LV_STORAGE_PROVIDER=r2', ['LV_R2_ACCOUNT_ID', 'LV_R2_ACCESS_KEY_ID', 'LV_R2_SECRET_ACCESS_KEY', 'LV_R2_BUCKET']);
  const endpoint = e['LV_R2_ENDPOINT'];
  return {
    accountId: v['LV_R2_ACCOUNT_ID']!,
    accessKeyId: v['LV_R2_ACCESS_KEY_ID']!,
    secretAccessKey: v['LV_R2_SECRET_ACCESS_KEY']!,
    bucket: v['LV_R2_BUCKET']!,
    ...(endpoint !== undefined && endpoint !== '' ? { endpoint } : {}),
  };
}

/** Reads and validates the Resend credential env vars. Throws with exactly what's missing. */
function resendEmailFromEnv(e: NodeJS.ProcessEnv): EmailPort {
  const v = requiredEnv(e, 'LV_EMAIL_PROVIDER=resend', ['LV_RESEND_API_KEY', 'LV_RESEND_FROM_EMAIL']);
  return new ResendEmailAdapter({ apiKey: v['LV_RESEND_API_KEY']!, from: v['LV_RESEND_FROM_EMAIL']! });
}

/** Reads and validates the Twilio credential env vars. Throws with exactly what's missing. */
function twilioSmsFromEnv(e: NodeJS.ProcessEnv): SmsPort {
  const v = requiredEnv(e, 'LV_SMS_PROVIDER=twilio', ['LV_TWILIO_ACCOUNT_SID', 'LV_TWILIO_AUTH_TOKEN', 'LV_TWILIO_FROM_NUMBER']);
  return new TwilioSmsAdapter({ accountSid: v['LV_TWILIO_ACCOUNT_SID']!, authToken: v['LV_TWILIO_AUTH_TOKEN']!, fromNumber: v['LV_TWILIO_FROM_NUMBER']! });
}

/**
 * Select the channel vendors (G1.1). Every channel defaults to the in-memory
 * stand-in (dev). A named real provider is refused until its adapter is wired —
 * the adapter is a one-file change behind the existing port — so no death-path
 * message ever goes silently to the in-memory sink while the operator believes a
 * real vendor is live. Selecting any real vendor also runs the 1.1 gate.
 *
 * Wired today: `LV_EMAIL_PROVIDER=resend`, `LV_SMS_PROVIDER=twilio`,
 * `LV_STORAGE_PROVIDER=r2` (`blobStoreFromEnv` below builds a second R2
 * instance for real content ciphertext, G2 — kept separate so this function's
 * signature and every existing caller stay unchanged). Push has no real
 * adapter yet.
 */
export function channelsFromEnv(e: NodeJS.ProcessEnv = process.env): Channels {
  const providers = {
    email: (e['LV_EMAIL_PROVIDER'] ?? 'memory').toLowerCase(),
    sms: (e['LV_SMS_PROVIDER'] ?? 'memory').toLowerCase(),
    push: (e['LV_PUSH_PROVIDER'] ?? 'memory').toLowerCase(),
    storage: (e['LV_STORAGE_PROVIDER'] ?? 'memory').toLowerCase(),
  };
  const named = Object.values(providers).filter((p) => p !== 'memory');
  assertVendorDataLocalization(named, e);
  for (const [kind, provider] of Object.entries(providers) as [keyof typeof providers, string][]) {
    if (WIRED_PROVIDERS[kind].has(provider)) continue;
    throw new Error(
      `${kind} provider "${provider}" is selected but no vendor adapter is wired (G1.1). ` +
        `Implement it behind the ${kind} port in src/adapters/channels/ and select it here; ` +
        `until then the boot fails rather than route ${kind} to the in-memory dev sink.`,
    );
  }
  return {
    email: providers.email === 'resend' ? resendEmailFromEnv(e) : new InMemoryEmailAdapter(),
    sms: providers.sms === 'twilio' ? twilioSmsFromEnv(e) : new InMemorySmsAdapter(),
    push: new InMemoryPushAdapter(),
    storage: providers.storage === 'r2' ? (createR2StorageAdapter(r2OptionsFromEnv(e)) as StoragePort) : new InMemoryStorageAdapter(),
  };
}

/**
 * Blob offload for real content ciphertext (G2/G1.1) — the same
 * `LV_STORAGE_PROVIDER` selection as `channelsFromEnv`, but returning the async
 * `BlobStore` half for `AuthoringService`/`ReleaseService`. `undefined` when the
 * provider is `memory` (default): ciphertext stays inline in the KV store,
 * unchanged from before this existed.
 */
export function blobStoreFromEnv(e: NodeJS.ProcessEnv = process.env): BlobStore | undefined {
  const provider = (e['LV_STORAGE_PROVIDER'] ?? 'memory').toLowerCase();
  if (provider === 'memory') return undefined;
  if (provider === 'r2') return createR2StorageAdapter(r2OptionsFromEnv(e));
  // Any other value already failed inside channelsFromEnv; unreachable when
  // configFromEnv calls both, but never silently return "no offload" here either.
  throw new Error(`storage provider "${provider}" is selected but no vendor adapter is wired (G1.1).`);
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
  const secrets = secretsFromEnv();
  const memorials = new MemorialStore(state);
  const publisher = new MemorialPublisher({ source: new InMemoryPublicContentSource(), store: memorials });
  const channels = channelsFromEnv();

  if (env('LV_STRIPE_SECRET_KEY') === '') {
    // eslint-disable-next-line no-console
    console.warn('[bootstrap] Stripe not configured — using the in-process billing fake (test mode).');
  }
  if (env('LV_STATE_BACKEND', 'file') === 'file') {
    // eslint-disable-next-line no-console
    console.warn('[bootstrap] Using the JSON-file state backend. Set LV_STATE_BACKEND=sqlite|postgres for production.');
  }
  for (const kind of ['EMAIL', 'SMS', 'PUSH', 'STORAGE'] as const) {
    const provider = env(`LV_${kind}_PROVIDER`, 'memory').toLowerCase();
    if (provider === 'memory') {
      // eslint-disable-next-line no-console
      console.warn(`[bootstrap] ${kind} channel is the in-memory dev sink — no real ${kind.toLowerCase()} is sent (G1.1).`);
    } else {
      // eslint-disable-next-line no-console
      console.log(`[bootstrap] ${kind} channel: ${provider} — real ${kind.toLowerCase()} is sent (G1.1).`);
    }
  }
  if ((env('LV_KMS_PROVIDER', 'local')).toLowerCase() === 'local') {
    // eslint-disable-next-line no-console
    console.warn('[bootstrap] KMS provider is the local master-key wrapper. Set LV_KMS_PROVIDER for a managed KMS (G2.1).');
  }

  return {
    state,
    cursors: state,
    credentials: state,
    auditFor,
    secrets,
    channels,
    publisher,
    contentPolicy: contentPolicyFromEnv(),
    keyWrapper: keyWrapperFromEnv(secrets),
    recipientAccessPolicy: recipientAccessPolicyFromEnv(),
    blobStore: blobStoreFromEnv(),
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

// Re-exported so callers keep importing the state/audit builders from the bootstrap.
export { stateBackend, auditFactory };
export type { KeyValueStore, AuditSink, AuditSinkFactory };
