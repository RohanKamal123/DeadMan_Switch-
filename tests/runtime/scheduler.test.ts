// Phase E — the worker. It must advance persisted state through the guarded
// transition only, catch up after an outage, never advance a human-gated state,
// send cadence reminders once, feed the weekly health check into the veto gate,
// and leave a verifiable durable audit trail.

import type { AuditSink } from '../../src/domain/audit';
import { HOLD_LENIENT_DAYS } from '../../src/domain/config';
import { Machine } from '../../src/domain/machine';
import {
  HashChainedAuditStore,
  InMemoryAppendOnlySink,
  InMemoryKeyValueStore,
  MachineRepository,
} from '../../src/persistence';
import {
  RecordingAlertSender,
  RecordingReminderSender,
  Scheduler,
  SYSTEM_ACTOR,
  type AuditSinkFactory,
} from '../../src/runtime';
import { T0, daysAfter, machineIn } from '../support/factory';

/** Per-account durable, tamper-evident audit stores, memoized so ticks share one trail. */
function memoAuditFactory(): { auditFor: AuditSinkFactory; storeFor: (id: string) => HashChainedAuditStore } {
  const stores = new Map<string, HashChainedAuditStore>();
  const storeFor = (id: string): HashChainedAuditStore => {
    let s = stores.get(id);
    if (s === undefined) {
      s = new HashChainedAuditStore(new InMemoryAppendOnlySink());
      stores.set(id, s);
    }
    return s;
  };
  return { auditFor: (id) => storeFor(id) as AuditSink, storeFor };
}

interface Harness {
  scheduler: Scheduler;
  machines: MachineRepository;
  reminders: RecordingReminderSender;
  alerts: RecordingAlertSender;
  storeFor: (id: string) => HashChainedAuditStore;
}

function harness(options: { probers?: Record<'email' | 'sms' | 'storage', () => boolean> } = {}): Harness {
  const stateStore = new InMemoryKeyValueStore();
  const cursorStore = new InMemoryKeyValueStore();
  const machines = new MachineRepository(stateStore);
  const reminders = new RecordingReminderSender();
  const alerts = new RecordingAlertSender();
  const { auditFor, storeFor } = memoAuditFactory();
  const scheduler = new Scheduler({
    machines,
    cursorStore,
    auditFor,
    reminderSender: reminders,
    alertSender: alerts,
    ...(options.probers ? { probers: options.probers } : {}),
  });
  return { scheduler, machines, reminders, alerts, storeFor };
}

/** Seed a persisted machine resting in `state` (context only; no audit yet). */
function seed(machines: MachineRepository, accountId: string, state: Parameters<typeof machineIn>[0], overrides = {}) {
  machines.save(accountId, Machine.restore(machineIn(state, overrides)));
}

describe('Scheduler.tickAccount — forward timers over persisted state', () => {
  it('advances ACTIVE → NUDGE once the check-in lapses, and persists it', () => {
    const h = harness();
    seed(h.machines, 'a1', 'ACTIVE', { lastLivenessAt: T0 });

    const report = h.scheduler.tickAccount('a1', daysAfter(T0, 7));
    expect(report?.appliedEvents).toEqual(['MISSED_CHECK_IN']);
    expect(h.machines.load('a1')!.state).toBe('NUDGE');
  });

  it('catches up multiple missed thresholds in one tick after an outage', () => {
    const h = harness();
    seed(h.machines, 'a1', 'ACTIVE', { lastLivenessAt: T0 });

    // Worker was down for 35 days: catch up ACTIVE → NUDGE → VERIFYING.
    const report = h.scheduler.tickAccount('a1', daysAfter(T0, 35));
    expect(report?.appliedEvents).toEqual(['MISSED_CHECK_IN', 'REACH_VERIFYING']);
    expect(h.machines.load('a1')!.state).toBe('VERIFYING');
  });

  it('returns null for an unknown account', () => {
    const h = harness();
    expect(h.scheduler.tickAccount('nope', T0)).toBeNull();
  });
});

describe('Scheduler.tickAccount — release timing and fail-safe', () => {
  it('does not release before the HOLD window, then releases with the system actor', () => {
    const h = harness();
    const holdStartedAt = daysAfter(T0, 31);
    seed(h.machines, 'a1', 'HOLD', { holdStartedAt });

    const early = h.scheduler.tickAccount('a1', daysAfter(holdStartedAt, HOLD_LENIENT_DAYS - 1));
    expect(early?.appliedEvents).toEqual([]);
    expect(h.machines.load('a1')!.state).toBe('HOLD');

    const onTime = h.scheduler.tickAccount('a1', daysAfter(holdStartedAt, HOLD_LENIENT_DAYS));
    expect(onTime?.appliedEvents).toEqual(['TRIGGER_PRIVATE_RELEASE']);
    expect(h.machines.load('a1')!.state).toBe('PRIVATE_RELEASE');

    // The release is audited to the system actor, and the trail verifies intact.
    const trail = h.storeFor('a1').all();
    const release = trail.find((e) => e.event === 'TRIGGER_PRIVATE_RELEASE')!;
    expect(release.actor).toBe(SYSTEM_ACTOR);
    expect(h.storeFor('a1').verify()).toEqual({ ok: true });
  });

  it('never advances a STALLED account, however long it waits (invariant 5)', () => {
    const h = harness();
    seed(h.machines, 'a1', 'STALLED', { verifyingStartedAt: daysAfter(T0, 30) });
    const report = h.scheduler.tickAccount('a1', daysAfter(T0, 3650));
    expect(report?.appliedEvents).toEqual([]);
    expect(h.machines.load('a1')!.state).toBe('STALLED');
  });

  it('does not release a frozen account past its window (fail safe)', () => {
    const h = harness();
    const holdStartedAt = daysAfter(T0, 31);
    seed(h.machines, 'a1', 'HOLD', { holdStartedAt, adminFrozen: true });
    const report = h.scheduler.tickAccount('a1', daysAfter(holdStartedAt, HOLD_LENIENT_DAYS + 5));
    expect(report?.appliedEvents).toEqual([]);
    expect(h.machines.load('a1')!.state).toBe('HOLD');
  });
});

describe('Scheduler.tickAccount — cadence reminders', () => {
  it('sends each NUDGE reminder once across ticks (idempotent via the cursor)', () => {
    const h = harness();
    seed(h.machines, 'a1', 'NUDGE', { lastLivenessAt: T0 });

    h.scheduler.tickAccount('a1', daysAfter(T0, 15)); // days 7 and 14
    const firstDays = h.reminders.sent.map((m) => m.day);
    expect(new Set(firstDays)).toEqual(new Set([7, 14]));

    const before = h.reminders.sent.length;
    h.scheduler.tickAccount('a1', daysAfter(T0, 22)); // only day 21 is new
    const newlySent = h.reminders.sent.slice(before);
    expect(new Set(newlySent.map((m) => m.day))).toEqual(new Set([21]));
  });

  it('renders static copy for HOLD cancel prompts and carries no link or code', () => {
    const h = harness();
    const holdStartedAt = daysAfter(T0, 31);
    seed(h.machines, 'a1', 'HOLD', { holdStartedAt });

    h.scheduler.tickAccount('a1', daysAfter(holdStartedAt, 1)); // day-1 cancel prompt
    const msg = h.reminders.sent.find((m) => m.templateId === 'hold.cancelPrompt')!;
    expect(msg.body.length).toBeGreaterThan(0);
    expect(msg.body).not.toMatch(/https?:\/\//);
    expect(msg.body).not.toMatch(/\b\d{6}\b/); // no 6-digit code
  });

  it('a restarted scheduler over the same stores does not re-send reminders', () => {
    const stateStore = new InMemoryKeyValueStore();
    const cursorStore = new InMemoryKeyValueStore();
    const machines = new MachineRepository(stateStore);
    machines.save('a1', Machine.restore(machineIn('NUDGE', { lastLivenessAt: T0 })));
    const { auditFor } = memoAuditFactory();

    const r1 = new RecordingReminderSender();
    const first = new Scheduler({ machines, cursorStore, auditFor, reminderSender: r1 });
    first.tickAccount('a1', daysAfter(T0, 22)); // sends 7, 14, 21
    expect(r1.sent.length).toBeGreaterThan(0);

    // "Restart": a brand-new scheduler over the SAME cursor store.
    const r2 = new RecordingReminderSender();
    const second = new Scheduler({ machines, cursorStore, auditFor, reminderSender: r2 });
    second.tickAccount('a1', daysAfter(T0, 23));
    expect(r2.sent).toHaveLength(0);
  });
});

describe('Scheduler.tickHealth — weekly health check feeds the veto gate', () => {
  it('a failing dependency blocks entry to VERIFYING and raises an alert (veto path 3)', () => {
    const probers = { email: () => true, sms: () => false, storage: () => true };
    const h = harness({ probers });
    seed(h.machines, 'a1', 'NUDGE', { lastLivenessAt: T0 });

    const report = h.scheduler.tickHealth(daysAfter(T0, 35));
    expect(report?.allOk).toBe(false);
    expect(h.machines.load('a1')!.context.dependencyHealthOk).toBe(false);
    expect(h.alerts.alerts.some((a) => a.message.includes('sms'))).toBe(true);

    // With the stack unhealthy, the day-30 threshold does NOT advance to VERIFYING.
    const tick = h.scheduler.tickAccount('a1', daysAfter(T0, 35));
    expect(tick?.appliedEvents).toEqual([]);
    expect(h.machines.load('a1')!.state).toBe('NUDGE');
  });

  it('is not due again within the same week', () => {
    const probers = { email: () => true, sms: () => true, storage: () => true };
    const h = harness({ probers });
    seed(h.machines, 'a1', 'ACTIVE');
    expect(h.scheduler.tickHealth(T0)).not.toBeNull();
    expect(h.scheduler.tickHealth(daysAfter(T0, 6))).toBeNull();
    expect(h.scheduler.tickHealth(daysAfter(T0, 7))).not.toBeNull();
  });
});

describe('Scheduler.runDueWork', () => {
  it('ticks every persisted account', () => {
    const h = harness();
    seed(h.machines, 'a1', 'ACTIVE', { lastLivenessAt: T0 });
    seed(h.machines, 'a2', 'ACTIVE', { lastLivenessAt: T0 });
    const reports = h.scheduler.runDueWork(daysAfter(T0, 7));
    expect(reports.map((r) => r.accountId).sort()).toEqual(['a1', 'a2']);
    expect(reports.every((r) => r.finalState === 'NUDGE')).toBe(true);
  });
});
