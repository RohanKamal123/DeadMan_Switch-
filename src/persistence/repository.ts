// Snapshot state repositories (DECISIONS.md §12 Phase D). They persist the
// CURRENT value of everything the system must not lose on a restart: accounts,
// the machine context (which carries confirmations), payloads, operator case
// files, and delivery records.
//
// Two rules from the roadmap are load-bearing here:
//
//   - THE DOMAIN STAYS PURE. Repositories sit behind the domain; they read and
//     write values, they never contain business logic.
//   - NO AD-HOC STATUS WRITES. A repository only ever persists a `MachineContext`
//     that `transition` produced, and reloads it via `Machine.restore`. It has no
//     method that sets a state directly — advancing the machine still goes
//     through `apply` → `transition`. (See MachineRepository.)
//
// Content/audit separation (5.3) is also structural: these repositories run over
// a `KeyValueStore`, never over the append-only audit sink, so operational data
// (notes, codes, links) cannot leak into the immutable trail.

import type { MachineContext } from '../domain/transition';
import { Machine } from '../domain/machine';
import type { AuditSink } from '../domain/audit';
import type { EvidenceMode } from '../domain/states';
import type { Payload } from '../domain/payload';
import type { Contact } from '../console/contacts';
import type { CaseFileSnapshot } from '../console/console';
import type { DeliverySnapshot, ReleaseRecipient } from '../delivery/release';
import type { KeyValueStore } from './kv';

/**
 * A typed JSON view over a `KeyValueStore`, namespaced so many record types can
 * share one backend without key collisions. `save`/`get`/`delete`/`all` — no
 * mutate-in-place, so a stored record only changes by being re-saved whole.
 */
export class SnapshotRepository<T> {
  constructor(
    private readonly store: KeyValueStore,
    private readonly namespace: string,
  ) {}

  private key(id: string): string {
    return `${this.namespace}:${id}`;
  }

  save(id: string, record: T): void {
    this.store.set(this.key(id), JSON.stringify(record));
  }

  get(id: string): T | undefined {
    const raw = this.store.get(this.key(id));
    return raw === undefined ? undefined : (JSON.parse(raw) as T);
  }

  has(id: string): boolean {
    return this.store.get(this.key(id)) !== undefined;
  }

  delete(id: string): void {
    this.store.delete(this.key(id));
  }

  ids(): readonly string[] {
    const prefix = `${this.namespace}:`;
    return this.store.keys().filter((k) => k.startsWith(prefix)).map((k) => k.slice(prefix.length));
  }

  all(): readonly T[] {
    return this.ids().map((id) => this.get(id)!);
  }
}

// --- account aggregate ------------------------------------------------------

/**
 * The top-level account record. Setup-time configuration (evidence mode, public
 * release) is stored here; the live state lives in the machine snapshot. Keeping
 * them apart means reloading configuration never risks touching state.
 */
export interface AccountRecord {
  readonly id: string;
  readonly createdAt: number;
  readonly evidenceMode: EvidenceMode;
  readonly publicReleaseEnabled: boolean;
  /** Soft-delete marker (DECISIONS.md 5.2); null while the account is live. */
  readonly softDeletedAt: number | null;
}

export class AccountRepository extends SnapshotRepository<AccountRecord> {
  constructor(store: KeyValueStore) {
    super(store, 'account');
  }
}

// --- machine context (carries confirmations) --------------------------------

export class MachineRepository {
  private readonly repo: SnapshotRepository<MachineContext>;

  constructor(store: KeyValueStore) {
    this.repo = new SnapshotRepository<MachineContext>(store, 'machine');
  }

  /** Persist the machine's current context. The context is a value `transition` produced. */
  save(accountId: string, machine: Machine): void {
    this.repo.save(accountId, machine.context);
  }

  /** The raw persisted context, if any. */
  getContext(accountId: string): MachineContext | undefined {
    return this.repo.get(accountId);
  }

  /**
   * Rebuild a `Machine` resting in the persisted context, wired to the given
   * durable audit sink. Returns undefined if the account has no snapshot yet.
   * Further changes go back through `apply` → `transition` — restore never
   * advances state on its own.
   */
  load(accountId: string, audit?: AuditSink): Machine | undefined {
    const context = this.repo.get(accountId);
    if (context === undefined) return undefined;
    return Machine.restore(context, audit === undefined ? {} : { audit });
  }

  ids(): readonly string[] {
    return this.repo.ids();
  }
}

// --- payloads (ciphertext only; per account) --------------------------------

/**
 * Payload storage, keyed per account. Payloads carry ciphertext only (the
 * `Payload` schema has no plaintext field), so this repository holds encrypted
 * bytes and metadata — never readable content.
 */
export class PayloadRepository {
  private readonly repo: SnapshotRepository<Payload>;

  constructor(store: KeyValueStore) {
    this.repo = new SnapshotRepository<Payload>(store, 'payload');
  }

  private key(accountId: string, payloadId: string): string {
    return `${accountId}/${payloadId}`;
  }

  save(accountId: string, payload: Payload): void {
    this.repo.save(this.key(accountId, payload.id), payload);
  }

  get(accountId: string, payloadId: string): Payload | undefined {
    return this.repo.get(this.key(accountId, payloadId));
  }

  forAccount(accountId: string): readonly Payload[] {
    const prefix = `${accountId}/`;
    return this.repo.ids().filter((k) => k.startsWith(prefix)).map((k) => this.repo.get(k)!);
  }

  delete(accountId: string, payloadId: string): void {
    this.repo.delete(this.key(accountId, payloadId));
  }
}

// --- contacts (roster; per account) -----------------------------------------

export class ContactRepository {
  private readonly repo: SnapshotRepository<Contact>;

  constructor(store: KeyValueStore) {
    this.repo = new SnapshotRepository<Contact>(store, 'contact');
  }

  private key(accountId: string, contactId: string): string {
    return `${accountId}/${contactId}`;
  }

  save(accountId: string, contact: Contact): void {
    this.repo.save(this.key(accountId, contact.id), contact);
  }

  get(accountId: string, contactId: string): Contact | undefined {
    return this.repo.get(this.key(accountId, contactId));
  }

  forAccount(accountId: string): readonly Contact[] {
    const prefix = `${accountId}/`;
    return this.repo.ids().filter((k) => k.startsWith(prefix)).map((k) => this.repo.get(k)!);
  }

  delete(accountId: string, contactId: string): void {
    this.repo.delete(this.key(accountId, contactId));
  }
}

// --- operator case files (operational, non-audit; per account) --------------

export class CaseFileRepository extends SnapshotRepository<CaseFileSnapshot> {
  constructor(store: KeyValueStore) {
    super(store, 'casefile');
  }
}

// --- delivery progress (per account) ----------------------------------------

export class DeliveryRepository extends SnapshotRepository<DeliverySnapshot> {
  constructor(store: KeyValueStore) {
    super(store, 'delivery');
  }
}

// --- release plan (per account) ---------------------------------------------

/**
 * The ordered recipient plan a release runs against. Ordering is strictly
 * user-defined (PRODUCT_SPEC.md §7: "No randomization anywhere in the death
 * path"), so it is captured here as data — the release engine never derives an
 * order. Held apart from the `DeliverySnapshot` (which carries the live
 * per-recipient progress, including issued codes and link tokens), so a returning
 * recipient can be authenticated after a restart by reconstructing the controller
 * from plan + snapshot. This is operational delivery state, never the audit trail.
 */
export interface ReleasePlan {
  readonly recipients: readonly ReleaseRecipient[];
}

export class ReleasePlanRepository extends SnapshotRepository<ReleasePlan> {
  constructor(store: KeyValueStore) {
    super(store, 'release-plan');
  }
}
