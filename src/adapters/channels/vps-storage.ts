// Phase G — the self-hosted (VPS) storage adapter (DECISIONS_PHASE_F_G.md
// G1 / G1.1).
//
// The chosen storage vendor is the operator's OWN VPS cloud, reached over plain
// HTTP(S) — no S3/cloud SDK, so nothing new enters the supply chain and swapping
// the store is a one-file change (G1). Keeping content on infrastructure the
// operator controls also sidesteps the 1.1 cross-border data-localization gate
// that a foreign object store would trip. The store is expected to expose a
// simple key/blob HTTP surface: `PUT {base}/{key}` writes, `GET {base}/{key}`
// reads, `DELETE {base}/{key}` removes — the shape nginx+dav, MinIO behind a
// small proxy, or a tiny custom service all provide. Only ciphertext is ever
// written here (the envelope; G2) — never plaintext.
//
// This is a DUMB PIPE (Preamble): it stores bytes and reports whether the store
// is reachable; it makes no state decision. `probe()` is the real health signal
// that drives veto path 3 (§6): it reflects a genuine canary round-trip against
// the remote store, refreshed in the background. Because `StoragePort` is
// synchronous, `put` is fire-and-forget with a write-through in-process cache so
// a same-process `get` still resolves; the async remote is the source of truth,
// exposed via `getRemote` for callers that need a durable read.

import type { StoragePort } from './ports';
import { InFlight, isOk, nodeHttpTransport, type HttpTransport } from './http-transport';

export interface VpsStorageConfig {
  /** Base URL of the self-hosted blob store, e.g. https://vault-store.myvps.example/blobs. */
  readonly baseUrl: string;
  /** Optional bearer token the store requires (injected secret; never logged). */
  readonly authToken?: string;
  /** Injectable for tests; defaults to the real Node http/https transport. */
  readonly transport?: HttpTransport;
  /** Observability hook. Receives NO secret or content — only a status detail. */
  readonly onError?: (detail: string) => void;
}

export class VpsStorageAdapter implements StoragePort {
  private readonly baseUrl: string;
  private readonly transport: HttpTransport;
  private readonly onError: ((detail: string) => void) | undefined;
  private readonly headers: Record<string, string>;
  private readonly inflight = new InFlight();
  private readonly writeThrough = new Map<string, string>();

  private healthy = true;

  constructor(config: VpsStorageConfig) {
    if (config.baseUrl === '') throw new Error('VpsStorageAdapter requires a baseUrl');
    this.baseUrl = config.baseUrl.replace(/\/+$/, '');
    this.transport = config.transport ?? nodeHttpTransport;
    this.onError = config.onError;
    this.headers = config.authToken === undefined ? {} : { authorization: `Bearer ${config.authToken}` };
  }

  private urlFor(key: string): string {
    return `${this.baseUrl}/${encodeURIComponent(key)}`;
  }

  /** Fire-and-forget write to the remote store, with a same-process write-through cache. */
  put(key: string, bytes: string): void {
    this.writeThrough.set(key, bytes);
    void this.inflight.track(this.upload(key, bytes));
  }

  /**
   * Synchronous read from the in-process write-through cache. Durable remote
   * reads are asynchronous — use `getRemote`. (In the current build encrypted
   * payloads are stored inline in the payload repository, so remote reads are not
   * on a hot path; this adapter's primary role is the health-probed durable sink.)
   */
  get(key: string): string | undefined {
    return this.writeThrough.get(key);
  }

  /** A durable read straight from the remote store. */
  async getRemote(key: string): Promise<string | undefined> {
    try {
      const res = await this.transport({ method: 'GET', url: this.urlFor(key), headers: this.headers });
      if (res.status === 404) return undefined;
      if (!isOk(res.status)) {
        this.setHealthy(false, `get returned ${res.status}`);
        return undefined;
      }
      return res.body;
    } catch {
      this.setHealthy(false, 'get failed');
      return undefined;
    }
  }

  private async upload(key: string, bytes: string): Promise<void> {
    try {
      const res = await this.transport({
        method: 'PUT',
        url: this.urlFor(key),
        headers: { ...this.headers, 'content-type': 'application/octet-stream' },
        body: bytes,
      });
      this.setHealthy(isOk(res.status), `put returned ${res.status}`);
    } catch {
      this.setHealthy(false, 'put failed');
    }
  }

  /** Cached remote health; kicks a background canary round-trip. Seed with `checkHealth()` at boot. */
  probe(): boolean {
    void this.inflight.track(this.checkHealth());
    return this.healthy;
  }

  /**
   * A real round-trip against the remote store: write a canary, read it back,
   * delete it. Anything other than a faithful round-trip marks the store
   * unhealthy — the conservative direction (blocks entry to VERIFYING, §6).
   */
  async checkHealth(): Promise<boolean> {
    const key = `__probe__/${Date.now()}`;
    const canary = '__probe__';
    try {
      const put = await this.transport({
        method: 'PUT',
        url: this.urlFor(key),
        headers: { ...this.headers, 'content-type': 'application/octet-stream' },
        body: canary,
      });
      if (!isOk(put.status)) return this.setHealthy(false, `probe put ${put.status}`);
      const got = await this.transport({ method: 'GET', url: this.urlFor(key), headers: this.headers });
      const roundTripped = isOk(got.status) && got.body === canary;
      this.setHealthy(roundTripped, roundTripped ? 'ok' : 'probe round-trip mismatch');
      // Best-effort cleanup; a failed delete does not fail the probe.
      void this.transport({ method: 'DELETE', url: this.urlFor(key), headers: this.headers }).catch(() => undefined);
      return this.healthy;
    } catch {
      return this.setHealthy(false, 'probe failed');
    }
  }

  /** Wait for in-flight uploads/probes to settle (tests, graceful shutdown). */
  drain(): Promise<void> {
    return this.inflight.drain();
  }

  private setHealthy(ok: boolean, detail: string): boolean {
    this.healthy = ok;
    if (!ok) this.onError?.(`vps-storage: ${detail}`);
    return ok;
  }
}
