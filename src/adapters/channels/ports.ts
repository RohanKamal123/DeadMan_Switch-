// Phase G — vendor adapter PORTS (DECISIONS_PHASE_F_G.md G1).
//
// Email / SMS / push / storage each sit behind a port interface. The core and
// the application/runtime tiers depend on these interfaces, never on a vendor
// SDK — so swapping a provider is a one-file change, and no SDK import ever
// escapes its adapter directory (G1; mirrors the models-adapter rule in
// CLAUDE.md). The adapters are dumb pipes: they send/store/probe and report
// success or failure; they make NO state decision.
//
// This file defines the ports and their in-memory implementations (for tests and
// local dev). Real vendor adapters (the concrete provider is G1.1, still OPEN)
// implement the same interfaces in their own files and are the only place a
// vendor SDK may be imported.

/** Email provider. `probe` performs a real deliverability self-test in production. */
export interface EmailPort {
  sendEmail(to: string, subject: string, body: string): void;
  probe(): boolean;
}

/** SMS provider. */
export interface SmsPort {
  sendSms(to: string, body: string): void;
  probe(): boolean;
}

/** Push-notification provider (used by cadence channels; not a health dependency). */
export interface PushPort {
  sendPush(to: string, body: string): void;
  probe(): boolean;
}

/**
 * The storage dependency's health signal for the weekly check (§6): "verifies a
 * stored payload round-trips." Deliberately narrow — `probe()` is the only
 * method any real caller (`dependencyProbers`) ever calls; the underlying
 * round-trip a concrete adapter performs to answer it is its own business, not
 * part of this contract. This narrowness is what lets `R2StorageAdapter`
 * implement it ALONGSIDE the separate async `BlobStore` port without a
 * sync-vs-async `put`/`get` name collision between the two.
 */
export interface StoragePort {
  probe(): boolean;
}

/**
 * Async blob storage for actual content ciphertext (G2, offloading large payload
 * bytes out of the KV state store — a photo/PDF up to the deployment's
 * `ContentPolicy` limit does not belong inline in a SQL row). Deliberately a
 * SEPARATE port from `StoragePort`: a real network-backed blob store cannot
 * satisfy `StoragePort`'s synchronous contract without either holding every
 * account's every payload in memory (defeats the point of offloading) or a
 * synchronous-network hack (unsound). `AuthoringService` (write) and
 * `ReleaseService` (read, to decrypt-and-serve) are the only two callers; the KV
 * state store keeps owning payload METADATA either way — this only carries bytes.
 */
export interface BlobStore {
  put(key: string, bytes: Buffer): Promise<void>;
  get(key: string): Promise<Buffer | undefined>;
  delete(key: string): Promise<void>;
}

/** In-memory `BlobStore` for tests and local dev. */
export class InMemoryBlobStore implements BlobStore {
  private readonly blobs = new Map<string, Buffer>();
  async put(key: string, bytes: Buffer): Promise<void> {
    this.blobs.set(key, bytes);
  }
  async get(key: string): Promise<Buffer | undefined> {
    return this.blobs.get(key);
  }
  async delete(key: string): Promise<void> {
    this.blobs.delete(key);
  }
}

/**
 * Publishes public-release content to the user-designated destination
 * (PRODUCT_SPEC.md §PUBLIC_RELEASE). The concrete destination (a public page,
 * an archive, …) is a deployment concern; the port keeps the death-path
 * orchestration independent of it. Only ever invoked once the machine is in
 * PUBLIC_RELEASE (the 14-day gap after PRIVATE_RELEASE, enforced by the machine).
 */
export interface PublicPublisher {
  publish(accountId: string, at: number): void;
}

// --- in-memory adapters (tests / local dev; no SDK) -------------------------

interface SentEmail {
  readonly to: string;
  readonly subject: string;
  readonly body: string;
}
interface SentText {
  readonly to: string;
  readonly body: string;
}

export class InMemoryEmailAdapter implements EmailPort {
  readonly sent: SentEmail[] = [];
  healthy = true;
  sendEmail(to: string, subject: string, body: string): void {
    this.sent.push({ to, subject, body });
  }
  probe(): boolean {
    return this.healthy;
  }
}

export class InMemorySmsAdapter implements SmsPort {
  readonly sent: SentText[] = [];
  healthy = true;
  sendSms(to: string, body: string): void {
    this.sent.push({ to, body });
  }
  probe(): boolean {
    return this.healthy;
  }
}

export class InMemoryPushAdapter implements PushPort {
  readonly sent: SentText[] = [];
  healthy = true;
  sendPush(to: string, body: string): void {
    this.sent.push({ to, body });
  }
  probe(): boolean {
    return this.healthy;
  }
}

export class InMemoryPublicPublisher implements PublicPublisher {
  readonly published: { accountId: string; at: number }[] = [];
  publish(accountId: string, at: number): void {
    this.published.push({ accountId, at });
  }
}

export class InMemoryStorageAdapter implements StoragePort {
  private readonly blobs = new Map<string, string>();
  healthy = true;
  put(key: string, bytes: string): void {
    this.blobs.set(key, bytes);
  }
  get(key: string): string | undefined {
    return this.blobs.get(key);
  }
  probe(): boolean {
    if (!this.healthy) return false;
    // A real probe writes a canary and reads it back; here we round-trip one.
    const canary = '__probe__';
    this.put(canary, canary);
    return this.get(canary) === canary;
  }
}
