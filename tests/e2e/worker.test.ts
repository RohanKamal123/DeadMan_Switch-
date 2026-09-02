// The worker wiring (composition.createWorker / startWorker). Proves the
// death-path clock is actually assembled and runnable in the deployable process:
// createWorker builds a scheduler wired to the real channel senders + probers,
// and startWorker drives runDueWork on a cadence, fails safe on a throw, and
// stops cleanly.

import { randomBytes } from 'crypto';
import type { AuditSink } from '../../src/domain/audit';
import { Machine } from '../../src/domain/machine';
import { InMemoryKeyValueStore, MachineRepository, HashChainedAuditStore, InMemoryAppendOnlySink } from '../../src/persistence';
import {
  InMemoryEmailAdapter,
  InMemoryPublicPublisher,
  InMemoryPushAdapter,
  InMemorySmsAdapter,
  InMemoryStorageAdapter,
} from '../../src/adapters';
import { createWorker, startWorker, startVendorHealthRefresh, flushIfPossible, flushPendingWrites, buildServices, type AppConfig } from '../../src/composition';
import { Scheduler, type AuditSinkFactory } from '../../src/runtime';
import { VERIFYING_THRESHOLD_DAYS, DAY_MS } from '../../src/domain/config';

function configWith(state: InMemoryKeyValueStore, now: () => number): AppConfig {
  const auditFor: AuditSinkFactory = () => new HashChainedAuditStore(new InMemoryAppendOnlySink()) as AuditSink;
  return {
    state,
    cursors: new InMemoryKeyValueStore(),
    credentials: new InMemoryKeyValueStore(),
    auditFor,
    secrets: { cancelTokenSecrets: ['c'], sessionSecret: 's', kmsMasterKey: randomBytes(32) },
    channels: {
      email: new InMemoryEmailAdapter(),
      sms: new InMemorySmsAdapter(),
      push: new InMemoryPushAdapter(),
      storage: new InMemoryStorageAdapter(),
    },
    publisher: new InMemoryPublicPublisher(),
    contentPolicy: { maxBytesByKind: { note: 1, photo: 1, pdf: 1 }, allowedMimeTypes: { note: [], photo: [], pdf: [] } },
    sessionTtlMs: 1000,
    opsEmail: 'ops@t.test',
    gatedBaseUrl: 'https://app.test/release',
    cancelFallback: {},
    now,
  };
}

describe('createWorker (death-path clock is assembled)', () => {
  it('advances an unresponsive account ACTIVE → VERIFYING at day 30', () => {
    const T0 = 1_700_000_000_000;
    const state = new InMemoryKeyValueStore();
    new MachineRepository(state).save('acct', new Machine({ now: T0 }));

    const worker = createWorker(configWith(state, () => T0));
    // Drive the wired scheduler directly at day 30 — this is exactly what the
    // interval loop calls.
    worker.runDueWork(T0 + VERIFYING_THRESHOLD_DAYS * DAY_MS);

    expect(new MachineRepository(state).getContext('acct')!.state).toBe('VERIFYING');
  });
});

describe('startWorker (interval loop)', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('runs once immediately and then on each interval', () => {
    let ticks = 0;
    const fake = { runDueWork: () => { ticks += 1; } } as unknown as Scheduler;

    const handle = startWorker(fake, { intervalMs: 1000, now: () => 0 });
    expect(ticks).toBe(1); // immediate catch-up run

    jest.advanceTimersByTime(3000);
    expect(ticks).toBe(4); // + three interval runs

    handle.stop();
    jest.advanceTimersByTime(5000);
    expect(ticks).toBe(4); // stopped: no further ticks
  });

  it('does not crash the loop when a tick throws (fail safe — an outage delays)', () => {
    let calls = 0;
    const errors: unknown[] = [];
    const flaky = {
      runDueWork: () => {
        calls += 1;
        throw new Error('transient store failure');
      },
    } as unknown as Scheduler;

    const handle = startWorker(flaky, { intervalMs: 1000, now: () => 0, onError: (e) => errors.push(e) });
    jest.advanceTimersByTime(2000);
    handle.stop();

    expect(calls).toBeGreaterThanOrEqual(3); // kept ticking despite throwing
    expect(errors.length).toBe(calls);
  });

  it('stop() is idempotent', () => {
    const fake = { runDueWork: () => undefined } as unknown as Scheduler;
    const handle = startWorker(fake, { intervalMs: 1000, now: () => 0 });
    expect(() => {
      handle.stop();
      handle.stop();
    }).not.toThrow();
  });
});

describe('startVendorHealthRefresh (network-backed vendor health, e.g. R2/Resend/Twilio)', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('is a no-op when no channel adapter has refreshProbe (e.g. every in-memory dev adapter)', () => {
    const state = new InMemoryKeyValueStore();
    const handle = startVendorHealthRefresh(configWith(state, () => 0), 1000);
    expect(handle).toBeUndefined();
  });

  it('actively refreshes a network-backed adapter on the given cadence, immediately and on interval', () => {
    const state = new InMemoryKeyValueStore();
    let calls = 0;
    const refreshable = { refreshProbe: async () => { calls += 1; return true; } };
    const config = configWith(state, () => 0);
    const withNetworkStorage: AppConfig = { ...config, channels: { ...config.channels, storage: refreshable as never } };

    const handle = startVendorHealthRefresh(withNetworkStorage, 1000);
    expect(handle).toBeDefined();
    expect(calls).toBe(1); // immediate

    jest.advanceTimersByTime(3000);
    expect(calls).toBe(4);

    handle!.stop();
    jest.advanceTimersByTime(5000);
    expect(calls).toBe(4); // stopped
  });

  it('refreshes every channel that has refreshProbe independently, not just storage', () => {
    const state = new InMemoryKeyValueStore();
    const seen: string[] = [];
    const refreshable = (name: string) => ({ refreshProbe: async () => { seen.push(name); return true; } });
    const config = configWith(state, () => 0);
    const multi: AppConfig = {
      ...config,
      channels: { ...config.channels, email: refreshable('email') as never, sms: refreshable('sms') as never, storage: refreshable('storage') as never },
    };

    const handle = startVendorHealthRefresh(multi, 1000);
    expect(seen.sort()).toEqual(['email', 'sms', 'storage']);
    handle!.stop();
  });
});

describe('flushIfPossible / flushPendingWrites (graceful shutdown)', () => {
  it('is a no-op for a value with no flush method (in-memory/SQLite/file backends)', async () => {
    await expect(flushIfPossible({})).resolves.toBeUndefined();
    await expect(flushIfPossible(undefined)).resolves.toBeUndefined();
  });

  it('awaits flush() when the value has one (e.g. the Postgres backend)', async () => {
    let flushed = false;
    const flushable = { flush: async () => { flushed = true; } };
    await flushIfPossible(flushable);
    expect(flushed).toBe(true);
  });

  it('propagates a flush failure rather than swallowing it', async () => {
    const flushable = { flush: async () => { throw new Error('write failed'); } };
    await expect(flushIfPossible(flushable)).rejects.toThrow('write failed');
  });

  it('flushPendingWrites flushes both state and authoring when they support it', async () => {
    const state = new InMemoryKeyValueStore();
    const config = configWith(state, () => 0);
    const stateFlushed: boolean[] = [];
    const flushableState = { ...state, flush: async () => { stateFlushed.push(true); } };
    const configWithFlush: AppConfig = { ...config, state: flushableState as never };
    const services = buildServices(configWithFlush);

    let authoringFlushed = false;
    const originalFlush = services.authoring.flush.bind(services.authoring);
    services.authoring.flush = async () => { authoringFlushed = true; await originalFlush(); };

    await flushPendingWrites(configWithFlush, services);
    expect(stateFlushed).toEqual([true]);
    expect(authoringFlushed).toBe(true);
  });
});
