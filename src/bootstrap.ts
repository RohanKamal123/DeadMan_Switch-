// The runnable entrypoint's engine (Phase F/G composition → a live process).
//
// `main.ts` is a thin shell; this module does the work so it can be tested
// without opening sockets. It turns three inputs into a running system:
//   - SECRETS from the environment (cancel HMAC, session, KMS) — `secretsFromEnv`;
//   - VENDOR credentials from the environment (Twilio, VPS, email) — `vendorConfigFromEnv`;
//   - non-secret OPERATIONAL config from a JSON file (ports, paths, policy VALUES).
//
// The split is deliberate: nothing secret is ever read from the committed config
// file, and the policy NUMBERS (content size limits, the recipient attempt cap)
// arrive as deployment config here — they are never invented in code (CLAUDE.md;
// 11.5 / F4.1). Persistence is file-backed (durable across a restart); the audit
// trail is a hash-chained per-account JSONL file (invariant 7).
//
// The public-release publisher is NOT yet a real destination (§PUBLIC_RELEASE is
// deployment config not built in V1); an in-memory publisher stands in and the
// process logs a clear warning so this is never mistaken for production-ready.

import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  InMemoryPublicPublisher,
  createVendorChannels,
  seedVendorHealth,
  vendorConfigFromEnv,
  type VendorChannels,
} from './adapters/channels';
import { secretsFromEnv } from './adapters/secrets';
import {
  FileAppendOnlySink,
  FileKeyValueStore,
  HashChainedAuditStore,
} from './persistence';
import type { AuditSink } from './domain/audit';
import type { ContentKind, ContentPolicy } from './domain/payload';
import type { RecipientAccessPolicy } from './delivery';
import type { AuditSinkFactory } from './runtime';
import { createRuntime, type AppConfig, type Runtime } from './composition';
import type { CancelFallback } from './http';
import type { RequestMetric, RequestMetrics } from './http';

// --- operational config (the non-secret JSON file) --------------------------

export interface StoragePaths {
  readonly statePath: string;
  readonly cursorPath: string;
  readonly credentialsPath: string;
  /** Directory holding one hash-chained JSONL audit file per account. */
  readonly auditDir: string;
}

export interface OpsConfig {
  readonly apiPort: number;
  readonly cancelPort: number;
  readonly schedulerIntervalMs: number;
  readonly sessionTtlMs: number;
  readonly opsEmail: string;
  readonly gatedBaseUrl: string;
  readonly cancelFallback: CancelFallback;
  readonly storage: StoragePaths;
  /** Deployment size/mime limits (11.5) — VALUES, not invented in code. */
  readonly contentPolicy: ContentPolicy;
  /** Deployment attempt cap / re-issue throttle (F4.1) — VALUES, not invented in code. */
  readonly recipientAccessPolicy: RecipientAccessPolicy;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

function req<T>(value: T | undefined, name: string): T {
  if (value === undefined || value === null) throw new ConfigError(`config field "${name}" is required`);
  return value;
}

function num(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new ConfigError(`config field "${name}" must be a number`);
  return value;
}

function str(value: unknown, name: string): string {
  if (typeof value !== 'string' || value === '') throw new ConfigError(`config field "${name}" must be a non-empty string`);
  return value;
}

const KINDS: readonly ContentKind[] = ['note', 'photo', 'pdf'];

function parseContentPolicy(raw: unknown): ContentPolicy {
  const obj = req(raw, 'contentPolicy') as Record<string, unknown>;
  const maxBytesRaw = req(obj['maxBytesByKind'], 'contentPolicy.maxBytesByKind') as Record<string, unknown>;
  const mimeRaw = req(obj['allowedMimeTypes'], 'contentPolicy.allowedMimeTypes') as Record<string, unknown>;
  const maxBytesByKind = {} as Record<ContentKind, number>;
  const allowedMimeTypes = {} as Record<ContentKind, readonly string[]>;
  for (const kind of KINDS) {
    maxBytesByKind[kind] = num(maxBytesRaw[kind], `contentPolicy.maxBytesByKind.${kind}`);
    const mimes = mimeRaw[kind];
    if (!Array.isArray(mimes) || mimes.some((m) => typeof m !== 'string')) {
      throw new ConfigError(`config field "contentPolicy.allowedMimeTypes.${kind}" must be a string array`);
    }
    allowedMimeTypes[kind] = mimes as string[];
  }
  return { maxBytesByKind, allowedMimeTypes };
}

/** Validate a parsed JSON object into an `OpsConfig`. Throws `ConfigError` on any gap. */
export function parseOpsConfig(raw: unknown): OpsConfig {
  if (typeof raw !== 'object' || raw === null) throw new ConfigError('config must be a JSON object');
  const o = raw as Record<string, unknown>;
  const storage = req(o['storage'], 'storage') as Record<string, unknown>;
  const fallbackRaw = (o['cancelFallback'] ?? {}) as Record<string, unknown>;
  const accessRaw = req(o['recipientAccessPolicy'], 'recipientAccessPolicy') as Record<string, unknown>;

  const cancelFallback: CancelFallback = {
    ...(typeof fallbackRaw['supportUrl'] === 'string' ? { supportUrl: fallbackRaw['supportUrl'] } : {}),
    ...(typeof fallbackRaw['inAppCancelUrl'] === 'string' ? { inAppCancelUrl: fallbackRaw['inAppCancelUrl'] } : {}),
  };

  return {
    apiPort: num(o['apiPort'], 'apiPort'),
    cancelPort: num(o['cancelPort'], 'cancelPort'),
    schedulerIntervalMs: num(o['schedulerIntervalMs'], 'schedulerIntervalMs'),
    sessionTtlMs: num(o['sessionTtlMs'], 'sessionTtlMs'),
    opsEmail: str(o['opsEmail'], 'opsEmail'),
    gatedBaseUrl: str(o['gatedBaseUrl'], 'gatedBaseUrl'),
    cancelFallback,
    storage: {
      statePath: str(storage['statePath'], 'storage.statePath'),
      cursorPath: str(storage['cursorPath'], 'storage.cursorPath'),
      credentialsPath: str(storage['credentialsPath'], 'storage.credentialsPath'),
      auditDir: str(storage['auditDir'], 'storage.auditDir'),
    },
    contentPolicy: parseContentPolicy(o['contentPolicy']),
    recipientAccessPolicy: {
      maxCodeAttempts: num(accessRaw['maxCodeAttempts'], 'recipientAccessPolicy.maxCodeAttempts'),
      maxReissues: num(accessRaw['maxReissues'], 'recipientAccessPolicy.maxReissues'),
    },
  };
}

/** Read and parse the ops config JSON named by `LV_CONFIG_FILE`. */
export function loadOpsConfig(env: NodeJS.ProcessEnv = process.env): OpsConfig {
  const file = env['LV_CONFIG_FILE'];
  if (file === undefined || file === '') throw new ConfigError('LV_CONFIG_FILE is not set');
  let raw: string;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    throw new ConfigError(`could not read LV_CONFIG_FILE at ${file}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ConfigError(`LV_CONFIG_FILE at ${file} is not valid JSON`);
  }
  return parseOpsConfig(parsed);
}

// --- durable audit factory --------------------------------------------------

/** Filesystem-safe account id so an id can never escape the audit directory. */
function safeAccountId(accountId: string): string {
  return accountId.replace(/[^A-Za-z0-9_-]/g, '_');
}

/**
 * A per-account hash-chained audit sink on disk (invariant 7). Each call loads
 * and re-verifies the existing chain, so a tampered trail throws rather than
 * being silently appended to.
 */
export function durableAuditFactory(auditDir: string): AuditSinkFactory {
  return (accountId: string): AuditSink =>
    new HashChainedAuditStore(new FileAppendOnlySink(path.join(auditDir, `${safeAccountId(accountId)}.log`)));
}

// --- assembling the AppConfig -----------------------------------------------

/** A metadata-only metrics sink that logs one line per request (F7; no tokens/ids). */
class ConsoleRequestMetrics implements RequestMetrics {
  record(metric: RequestMetric): void {
    // Pathname, method, status, duration only — never the query string or a body.
    // eslint-disable-next-line no-console
    console.log(`[metric] ${metric.method} ${metric.path} ${metric.status} ${metric.durationMs}ms`);
  }
}

export interface BuiltConfig {
  readonly config: AppConfig;
  readonly ops: OpsConfig;
  readonly channels: VendorChannels;
  readonly metrics: RequestMetrics;
}

/**
 * Build a full `AppConfig` from operational config + environment secrets/vendors.
 * Secrets and vendor credentials come from the environment; policy values come
 * from `ops`. File-backed persistence is created here (durable across restarts).
 */
export function buildAppConfig(ops: OpsConfig, env: NodeJS.ProcessEnv = process.env): BuiltConfig {
  const secrets = secretsFromEnv(env);
  const channels = createVendorChannels(vendorConfigFromEnv(env));
  const publisher = new InMemoryPublicPublisher();

  const config: AppConfig = {
    state: new FileKeyValueStore(ops.storage.statePath),
    cursors: new FileKeyValueStore(ops.storage.cursorPath),
    credentials: new FileKeyValueStore(ops.storage.credentialsPath),
    auditFor: durableAuditFactory(ops.storage.auditDir),
    secrets,
    channels,
    publisher,
    contentPolicy: ops.contentPolicy,
    recipientAccessPolicy: ops.recipientAccessPolicy,
    sessionTtlMs: ops.sessionTtlMs,
    opsEmail: ops.opsEmail,
    gatedBaseUrl: ops.gatedBaseUrl,
    cancelFallback: ops.cancelFallback,
    schedulerIntervalMs: ops.schedulerIntervalMs,
    now: Date.now,
  };
  return { config, ops, channels, metrics: new ConsoleRequestMetrics() };
}

// --- the live process -------------------------------------------------------

export interface RunningApp {
  readonly runtime: Runtime;
  readonly ops: OpsConfig;
  /** Stop the driver and close both servers. Resolves when the ports are free. */
  shutdown(): Promise<void>;
}

function log(message: string): void {
  // eslint-disable-next-line no-console
  console.log(`[legacy-vault] ${message}`);
}

/**
 * Boot the whole system: seed vendor health, start the two servers and the
 * scheduler driver. The cancel server is its own process-level failure domain in
 * spirit (F1.4) — here it is a second `http.Server` on its own port.
 */
export async function startApp(env: NodeJS.ProcessEnv = process.env): Promise<RunningApp> {
  const ops = loadOpsConfig(env);
  const { config, channels, metrics } = buildAppConfig(ops, env);
  const runtime = createRuntime(config, metrics);

  // Seed real vendor health BEFORE serving, so the first weekly probe reflects
  // reality rather than the optimistic default (drives veto path 3 honestly).
  await seedVendorHealth(channels);

  await Promise.all([
    listen(runtime.apiServer, ops.apiPort, 'api'),
    listen(runtime.cancelServer, ops.cancelPort, 'cancel'),
  ]);
  runtime.driver.start();
  log(`scheduler driver ticking every ${ops.schedulerIntervalMs}ms`);
  log('WARNING: public-release publisher is an in-memory stand-in — §PUBLIC_RELEASE destination is not yet wired.');

  const shutdown = async (): Promise<void> => {
    log('shutting down…');
    runtime.driver.stop();
    await Promise.all([close(runtime.apiServer), close(runtime.cancelServer)]);
    log('stopped.');
  };
  return { runtime, ops, shutdown };
}

function listen(server: import('node:http').Server, port: number, name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, () => {
      server.off('error', reject);
      log(`${name} server listening on :${port}`);
      resolve();
    });
  });
}

function close(server: import('node:http').Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}
