// Cloudflare R2 blob storage adapter (G1.1) — the ONLY place the AWS S3 SDK is
// imported, mirroring the sqlite/postgres driver bindings (no vendor SDK escapes
// its adapter file). R2 speaks the S3 API, so this is a thin wrapper over
// `@aws-sdk/client-s3` pointed at R2's endpoint.
//
//   npm install @aws-sdk/client-s3
//   LV_STORAGE_PROVIDER=r2
//   LV_R2_ACCOUNT_ID=...  LV_R2_ACCESS_KEY_ID=...  LV_R2_SECRET_ACCESS_KEY=...
//   LV_R2_BUCKET=...      LV_VENDOR_DATA_REGION=... (1.1 gate; R2 has no
//                          Bangladesh region, so this will need the cross-border
//                          acknowledgement — a deliberate choice, not a default)
//
// TWO INTERFACES, ONE OBJECT: `R2StorageAdapter` implements both the async
// `BlobStore` (real content ciphertext, G2) and the sync `StoragePort` (the
// weekly health probe, §6). The sync half cannot make a real network call — a
// blocking-sync HTTP client is unsound, and caching every account's content in
// memory just to answer `probe()` defeats the point of offloading it to R2 in
// the first place. So `probe()` returns a CACHED last-known-good boolean,
// updated by real put/get traffic and by an explicit `refreshProbe()` the
// deployment can call periodically. The cache DEFAULTS TO FALSE — unknown health
// reads as unhealthy — because a storage failure only blocks entry to VERIFYING
// (veto path 3, §5): the safe, conservative direction the whole product is built
// around. A probe that lags reality by one refresh interval is an acceptable
// cost for never reporting "healthy" on a guess.

import { randomUUID } from 'node:crypto';
import type { BlobStore, StoragePort } from './ports';

/**
 * The minimal shape this adapter calls on an AWS SDK v3 S3 client, hand-rolled
 * (not imported) so the codebase typechecks with no SDK installed — the same
 * technique `sqlite.ts` uses for `better-sqlite3`. Matches
 * `@aws-sdk/client-s3`'s runtime shape; a response `Body` in Node exposes
 * `transformToByteArray()` via `@smithy/util-stream`.
 */
export interface S3ClientLike {
  send(command: unknown): Promise<{ Body?: { transformToByteArray(): Promise<Uint8Array> } }>;
}

export interface S3CommandCtor {
  new (input: Record<string, unknown>): unknown;
}

export interface R2Commands {
  readonly PutObjectCommand: S3CommandCtor;
  readonly GetObjectCommand: S3CommandCtor;
  readonly DeleteObjectCommand: S3CommandCtor;
}

interface S3Sdk extends R2Commands {
  readonly S3Client: new (config: Record<string, unknown>) => S3ClientLike;
}

function requireS3Sdk(): S3Sdk {
  try {
    // Lazy, indirect require so bundlers/typecheck don't hard-depend on it.
    const req = eval('require') as (id: string) => unknown;
    return req('@aws-sdk/client-s3') as S3Sdk;
  } catch {
    throw new Error('@aws-sdk/client-s3 is not installed. Run `npm install @aws-sdk/client-s3` to use LV_STORAGE_PROVIDER=r2.');
  }
}

export interface R2StorageAdapterOptions {
  readonly client: S3ClientLike;
  readonly bucket: string;
  readonly commands: R2Commands;
}

export class R2StorageAdapter implements BlobStore, StoragePort {
  private readonly client: S3ClientLike;
  private readonly bucket: string;
  private readonly commands: R2Commands;
  /** Cached last-known-good health, updated by real traffic and refreshProbe(). Fails safe: unknown = unhealthy. */
  private lastProbeOk = false;

  constructor(options: R2StorageAdapterOptions) {
    this.client = options.client;
    this.bucket = options.bucket;
    this.commands = options.commands;
  }

  async put(key: string, bytes: Buffer): Promise<void> {
    try {
      await this.client.send(new this.commands.PutObjectCommand({ Bucket: this.bucket, Key: key, Body: bytes }));
      this.lastProbeOk = true;
    } catch (error) {
      this.lastProbeOk = false;
      throw error;
    }
  }

  async get(key: string): Promise<Buffer | undefined> {
    try {
      const res = await this.client.send(new this.commands.GetObjectCommand({ Bucket: this.bucket, Key: key }));
      if (res.Body === undefined) return undefined;
      const bytes = await res.Body.transformToByteArray();
      this.lastProbeOk = true;
      return Buffer.from(bytes);
    } catch (error) {
      // A missing key is not a health failure; only a transport/auth error is.
      if (isNotFound(error)) return undefined;
      this.lastProbeOk = false;
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new this.commands.DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  /** Synchronous health read for the weekly check (§6). See file header: cached, defaults unhealthy. */
  probe(): boolean {
    return this.lastProbeOk;
  }

  /**
   * Round-trip a canary key through R2 and refresh the cached probe result.
   * Call this on a cadence (independent of the sync scheduler) so `probe()`
   * reflects reality even when no real content traffic has happened recently.
   */
  async refreshProbe(): Promise<boolean> {
    const canary = `__probe__/${randomUUID()}`;
    try {
      await this.put(canary, Buffer.from('probe'));
      const back = await this.get(canary);
      this.lastProbeOk = back !== undefined && back.toString('utf8') === 'probe';
    } catch {
      this.lastProbeOk = false;
    }
    return this.lastProbeOk;
  }
}

function isNotFound(error: unknown): boolean {
  const name = (error as { name?: unknown } | null)?.name;
  return name === 'NoSuchKey' || name === 'NotFound';
}

export interface CreateR2StorageAdapterOptions {
  /** Cloudflare account id — the endpoint is `https://<accountId>.r2.cloudflarestorage.com`. */
  readonly accountId: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly bucket: string;
  /** Override the derived endpoint (rarely needed — a custom domain). */
  readonly endpoint?: string;
}

/**
 * Build a real, R2-backed adapter from credentials — the one function that
 * touches `@aws-sdk/client-s3`. Throws a clear, actionable error if the package
 * is not installed, exactly like `createSqliteDriver`/`createPgExecutor`.
 */
export function createR2StorageAdapter(options: CreateR2StorageAdapterOptions): R2StorageAdapter {
  const sdk = requireS3Sdk();
  const endpoint = options.endpoint ?? `https://${options.accountId}.r2.cloudflarestorage.com`;
  const client = new sdk.S3Client({
    region: 'auto',
    endpoint,
    credentials: { accessKeyId: options.accessKeyId, secretAccessKey: options.secretAccessKey },
  });
  return new R2StorageAdapter({
    client,
    bucket: options.bucket,
    commands: { PutObjectCommand: sdk.PutObjectCommand, GetObjectCommand: sdk.GetObjectCommand, DeleteObjectCommand: sdk.DeleteObjectCommand },
  });
}
