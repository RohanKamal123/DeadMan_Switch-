// Phase D — the durable, tamper-evident audit store (DECISIONS.md §12 Phase D;
// invariant 7). The audit trail is the one thing that must be trustworthy before
// anything else, so these tests come first and are exhaustive: chaining,
// integrity verification, tamper/deletion/reorder detection, metadata-only
// enforcement, durability across a "restart", and drop-in use as an AuditSink.

import { promises as fs } from 'node:fs';
import * as fsSync from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { SensitiveMetadataError } from '../../src/domain/audit';
import { AUDIT_RETENTION_DAYS, DAY_MS } from '../../src/domain/config';
import { Machine } from '../../src/domain/machine';
import {
  AuditIntegrityError,
  FileAppendOnlySink,
  GENESIS_HASH,
  HashChainedAuditStore,
  InMemoryAppendOnlySink,
  auditRetentionCutoff,
  isBeyondAuditHorizon,
} from '../../src/persistence';

const T0 = 1_700_000_000_000;

function meta(kind: 'CONTEXT' = 'CONTEXT', event = 'TEST') {
  return { at: T0, kind, event, metadata: {} as Record<string, string | number | boolean> };
}

describe('HashChainedAuditStore — chaining', () => {
  it('assigns sequential seq and a genesis prevHash to the first entry', () => {
    const store = new HashChainedAuditStore(new InMemoryAppendOnlySink());
    const first = store.append(meta());
    expect(first.seq).toBe(1);
    const chained = store.chainedEntries()[0]!;
    expect(chained.prevHash).toBe(GENESIS_HASH);
    expect(chained.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('links each entry hash to the previous entry (a hash chain)', () => {
    const store = new HashChainedAuditStore(new InMemoryAppendOnlySink());
    store.append(meta('CONTEXT', 'A'));
    store.append(meta('CONTEXT', 'B'));
    store.append(meta('CONTEXT', 'C'));
    const chained = store.chainedEntries();
    expect(chained).toHaveLength(3);
    expect(chained[1]!.prevHash).toBe(chained[0]!.hash);
    expect(chained[2]!.prevHash).toBe(chained[1]!.hash);
  });

  it('verify() reports ok on an untouched chain', () => {
    const store = new HashChainedAuditStore(new InMemoryAppendOnlySink());
    for (let i = 0; i < 5; i++) store.append(meta('CONTEXT', `E${i}`));
    expect(store.verify()).toEqual({ ok: true });
  });
});

describe('HashChainedAuditStore — metadata-only enforcement (invariants 6 & 7)', () => {
  it('rejects a forbidden metadata key before it can be written', () => {
    const store = new HashChainedAuditStore(new InMemoryAppendOnlySink());
    expect(() =>
      store.append({ at: T0, kind: 'OUTREACH', event: 'X', metadata: { code: '123456' } }),
    ).toThrow(SensitiveMetadataError);
    // Nothing was persisted by the rejected append.
    expect(store.length).toBe(0);
  });

  it('rejects a URL hidden in a metadata value', () => {
    const store = new HashChainedAuditStore(new InMemoryAppendOnlySink());
    expect(() =>
      store.append({ at: T0, kind: 'OUTREACH', event: 'X', metadata: { note_field: 'see https://evil.example/x' } }),
    ).toThrow(SensitiveMetadataError);
  });
});

describe('HashChainedAuditStore — tamper evidence', () => {
  it('detects an edited entry on reload', () => {
    const sink = new InMemoryAppendOnlySink();
    const store = new HashChainedAuditStore(sink);
    store.append(meta('CONTEXT', 'A'));
    store.append(meta('CONTEXT', 'B'));

    // Tamper with the persisted bytes of the first record.
    const lines = sink.read().slice();
    const parsed = JSON.parse(lines[0]!);
    parsed.event = 'FORGED';
    sink.overwrite([JSON.stringify(parsed), lines[1]!]);

    expect(() => new HashChainedAuditStore(sink)).toThrow(AuditIntegrityError);
  });

  it('detects a deleted (dropped) entry via the broken link', () => {
    const sink = new InMemoryAppendOnlySink();
    const store = new HashChainedAuditStore(sink);
    store.append(meta('CONTEXT', 'A'));
    store.append(meta('CONTEXT', 'B'));
    store.append(meta('CONTEXT', 'C'));

    const lines = sink.read().slice();
    sink.overwrite([lines[0]!, lines[2]!]); // drop the middle entry

    expect(() => new HashChainedAuditStore(sink)).toThrow(AuditIntegrityError);
  });

  it('detects reordered entries', () => {
    const sink = new InMemoryAppendOnlySink();
    const store = new HashChainedAuditStore(sink);
    store.append(meta('CONTEXT', 'A'));
    store.append(meta('CONTEXT', 'B'));

    const lines = sink.read().slice();
    sink.overwrite([lines[1]!, lines[0]!]); // swap order

    expect(() => new HashChainedAuditStore(sink)).toThrow(AuditIntegrityError);
  });

  it('verify() names where the chain broke without throwing', () => {
    const sink = new InMemoryAppendOnlySink();
    const store = new HashChainedAuditStore(sink);
    store.append(meta('CONTEXT', 'A'));
    store.append(meta('CONTEXT', 'B'));
    const lines = sink.read().slice();
    const parsed = JSON.parse(lines[1]!);
    parsed.actor = 'intruder';
    sink.overwrite([lines[0]!, JSON.stringify(parsed)]);

    const result = HashChainedAuditStore.verifySink(sink);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.brokenAt).toBe(2);
  });
});

describe('HashChainedAuditStore — durability across a restart (file-backed)', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lv-audit-'));
  });
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('reloads a persisted, verified chain from disk', () => {
    const file = path.join(dir, 'audit.log');
    const first = new HashChainedAuditStore(new FileAppendOnlySink(file));
    first.append(meta('CONTEXT', 'A'));
    first.append(meta('CONTEXT', 'B'));

    // A brand-new process/store over the same file — state survives the restart.
    const reloaded = new HashChainedAuditStore(new FileAppendOnlySink(file));
    expect(reloaded.length).toBe(2);
    expect(reloaded.all().map((e) => e.event)).toEqual(['A', 'B']);
    expect(reloaded.verify()).toEqual({ ok: true });

    // Appends continue the same chain across the restart.
    reloaded.append(meta('CONTEXT', 'C'));
    const chained = reloaded.chainedEntries();
    expect(chained[2]!.prevHash).toBe(chained[1]!.hash);
    expect(fsSync.existsSync(file)).toBe(true);
  });

  it('creates the parent directory if missing', () => {
    const file = path.join(dir, 'nested', 'deep', 'audit.log');
    const store = new HashChainedAuditStore(new FileAppendOnlySink(file));
    store.append(meta('CONTEXT', 'A'));
    expect(fsSync.existsSync(file)).toBe(true);
  });
});

describe('HashChainedAuditStore — drop-in AuditSink for the machine', () => {
  it('persists a real transition chain immutably', () => {
    const store = new HashChainedAuditStore(new InMemoryAppendOnlySink());
    const machine = new Machine({ now: T0, audit: store });
    machine.apply({ type: 'CHECK_IN', at: T0 });
    machine.apply({ type: 'MISSED_CHECK_IN', at: T0 + 8 * DAY_MS });

    const events = store.all().map((e) => e.event);
    expect(events).toContain('MISSED_CHECK_IN');
    expect(store.verify()).toEqual({ ok: true });
  });
});

describe('audit retention horizon (DECISIONS.md 5.3)', () => {
  it('cutoff is exactly the 2-year (730-day) horizon', () => {
    expect(auditRetentionCutoff(T0)).toBe(T0 - AUDIT_RETENTION_DAYS * DAY_MS);
  });

  it('an entry older than the horizon is beyond it; one on the boundary is not', () => {
    const now = T0;
    expect(isBeyondAuditHorizon(now - AUDIT_RETENTION_DAYS * DAY_MS - 1, now)).toBe(true);
    expect(isBeyondAuditHorizon(now - AUDIT_RETENTION_DAYS * DAY_MS, now)).toBe(false);
  });
});
