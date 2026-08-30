// The durable, tamper-evident audit store (DECISIONS.md §12 Phase D; invariant
// 7; retention 5.3). It is the highest-priority Phase D deliverable: "nothing is
// trustworthy until this exists."
//
// It satisfies the domain `AuditSink` interface, so it drops in wherever the
// in-memory `AuditLog` was used (the machine, console, delivery, retention) with
// no domain change. On top of that contract it adds two things the in-memory log
// could not give:
//
//   1. DURABILITY — records are persisted through an `AppendOnlySink`, so state
//      survives a restart (a file-backed sink rebuilds the chain on load).
//   2. TAMPER EVIDENCE — every record carries `hash = H(prevHash · record)`, a
//      hash chain. Editing, deleting, or reordering any record breaks the chain
//      and is detected on load (`AuditIntegrityError`) or by `verify()`. The
//      store cannot un-break a broken chain; it can only refuse to trust it.
//
// Metadata-only is enforced at the boundary exactly as the in-memory log does
// (`assertMetadataSafe`) — the trail never holds content, a URL, or a code
// (invariants 6 & 7). The trail is append-only: there is no delete, update, or
// clear anywhere in this class.

import { createHash } from 'node:crypto';

import {
  assertMetadataSafe,
  type AuditEntry,
  type AuditEntryInput,
  type AuditSink,
} from '../domain/audit';
import { AUDIT_RETENTION_DAYS, DAY_MS } from '../domain/config';
import type { AppendOnlySink } from './sinks';

/** The prevHash of the first entry: a fixed anchor, not a real record's hash. */
export const GENESIS_HASH = '0'.repeat(64);

/** A persisted audit entry with its tamper-evidence links. */
export interface ChainedAuditEntry extends AuditEntry {
  readonly prevHash: string;
  readonly hash: string;
}

export type VerifyResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly brokenAt: number; readonly reason: string };

export class AuditIntegrityError extends Error {
  constructor(
    message: string,
    readonly brokenAt: number,
  ) {
    super(message);
    this.name = 'AuditIntegrityError';
  }
}

// --- canonical serialization ------------------------------------------------
// The hash must be reproducible byte-for-byte, so object keys are serialized in
// a fixed order regardless of insertion order.

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  const keys = Object.keys(value as Record<string, unknown>).sort();
  const body = keys
    .map((k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`)
    .join(',');
  return `{${body}}`;
}

/** The immutable core of an entry — everything the hash commits to (not the hash itself). */
function entryCore(entry: AuditEntry): Record<string, unknown> {
  const core: Record<string, unknown> = {
    seq: entry.seq,
    at: entry.at,
    kind: entry.kind,
    event: entry.event,
    metadata: entry.metadata,
  };
  if (entry.from !== undefined) core.from = entry.from;
  if (entry.to !== undefined) core.to = entry.to;
  if (entry.actor !== undefined) core.actor = entry.actor;
  return core;
}

function computeHash(prevHash: string, entry: AuditEntry): string {
  return createHash('sha256').update(`${prevHash}.${stableStringify(entryCore(entry))}`).digest('hex');
}

/** Recompute the chain over parsed records and report the first break, if any. */
function verifyChain(records: readonly ChainedAuditEntry[]): VerifyResult {
  let prevHash = GENESIS_HASH;
  for (let i = 0; i < records.length; i++) {
    const record = records[i]!;
    const expectedSeq = i + 1;
    if (record.seq !== expectedSeq) {
      return { ok: false, brokenAt: expectedSeq, reason: `seq ${record.seq} out of order at position ${expectedSeq}` };
    }
    if (record.prevHash !== prevHash) {
      return { ok: false, brokenAt: expectedSeq, reason: `prevHash link broken at seq ${expectedSeq}` };
    }
    const recomputed = computeHash(prevHash, record);
    if (recomputed !== record.hash) {
      return { ok: false, brokenAt: expectedSeq, reason: `hash mismatch at seq ${expectedSeq} (record altered)` };
    }
    prevHash = record.hash;
  }
  return { ok: true };
}

function parseRecords(lines: readonly string[]): ChainedAuditEntry[] {
  return lines.map((line, i) => {
    try {
      return JSON.parse(line) as ChainedAuditEntry;
    } catch {
      throw new AuditIntegrityError(`audit record at position ${i + 1} is not valid JSON`, i + 1);
    }
  });
}

export class HashChainedAuditStore implements AuditSink {
  private readonly entries: ChainedAuditEntry[];

  /**
   * Load and verify the existing chain. A broken chain throws on construction —
   * a tampered trail must never be silently trusted or appended to.
   */
  constructor(private readonly sink: AppendOnlySink) {
    this.entries = parseRecords(sink.read());
    const result = verifyChain(this.entries);
    if (!result.ok) {
      throw new AuditIntegrityError(`audit trail integrity check failed: ${result.reason}`, result.brokenAt);
    }
  }

  append(input: AuditEntryInput): AuditEntry {
    // Same boundary guard as the in-memory log — no content, URL, or code.
    assertMetadataSafe(input.metadata);
    const prevHash = this.entries.length === 0 ? GENESIS_HASH : this.entries[this.entries.length - 1]!.hash;
    const base: AuditEntry = {
      ...input,
      metadata: Object.freeze({ ...input.metadata }),
      seq: this.entries.length + 1,
    };
    const hash = computeHash(prevHash, base);
    const entry: ChainedAuditEntry = Object.freeze({ ...base, prevHash, hash });
    // Persist first, then accept into memory: if the write throws, the in-memory
    // view stays consistent with what is durable.
    this.sink.append(JSON.stringify(entry));
    this.entries.push(entry);
    return entry;
  }

  all(): readonly AuditEntry[] {
    return Object.freeze(this.entries.slice());
  }

  /** The persisted entries with their hash-chain links, for export or inspection. */
  chainedEntries(): readonly ChainedAuditEntry[] {
    return Object.freeze(this.entries.slice());
  }

  get length(): number {
    return this.entries.length;
  }

  /** Re-read the durable bytes and verify the chain end-to-end. */
  verify(): VerifyResult {
    return verifyChain(parseRecords(this.sink.read()));
  }

  /** Verify a sink's contents without constructing a store (never throws). */
  static verifySink(sink: AppendOnlySink): VerifyResult {
    try {
      return verifyChain(parseRecords(sink.read()));
    } catch (err) {
      if (err instanceof AuditIntegrityError) {
        return { ok: false, brokenAt: err.brokenAt, reason: err.message };
      }
      throw err;
    }
  }

  /**
   * Entries whose timestamp is still within the 2-year retention horizon
   * (DECISIONS.md 5.3). A QUERY only: executing a prune re-anchors the chain and
   * belongs to the Phase E scheduler, mirroring how `retention.ts` gates content
   * purges for the caller to act on. Nothing here deletes.
   */
  entriesWithinHorizon(now: number): readonly ChainedAuditEntry[] {
    const cutoff = auditRetentionCutoff(now);
    return Object.freeze(this.entries.filter((e) => e.at >= cutoff));
  }
}

/** The timestamp before which audit metadata is beyond its 2-year horizon (5.3). */
export function auditRetentionCutoff(now: number): number {
  return now - AUDIT_RETENTION_DAYS * DAY_MS;
}

export function isBeyondAuditHorizon(entryAt: number, now: number): boolean {
  return entryAt < auditRetentionCutoff(now);
}
