// The Phase E worker (DECISIONS.md §12 Phase E). It is the only place that fires
// time events, and it does so with reliability as its single job: the guards
// already make an early release impossible, so the worker exists so a release is
// never LATE by accident (the cheap failure, still worth avoiding).
//
// It owns no business logic. Every state change goes through `machine.apply` →
// `transition` (no ad-hoc status writes), every accepted transition is persisted
// to the durable audit sink and the machine snapshot, and every decision is
// re-derived from persisted state on each tick — so a restart loses nothing and
// a missed interval is caught up one guarded step at a time.
//
// FAIL SAFE (invariant 5; DECISIONS.md 7.3): a rejected transition stops the
// advance loop and leaves the account where it was. A worker outage delays
// events; it never advances an account toward release on its own.

import type { AuditSink } from '../domain/audit';
import type { Machine } from '../domain/machine';
import type { State } from '../domain/states';
import {
  applyHealthToMachine,
  healthAlerts,
  runHealthCheck,
  type Dependency,
  type HealthReport,
  type Prober,
} from '../health/health';
import { MachineRepository, SnapshotRepository, type KeyValueStore } from '../persistence';
import { dueReminders, holdDaysRemaining, isHealthCheckDue, nextDueEvent } from './due';
import { renderReminderBody, type AlertSender, type ReminderSender } from './senders';

/** Bounds the catch-up loop; only a handful of forward transitions are ever possible. */
const MAX_ADVANCE_STEPS = 16;

/** Per-account cursor: when the worker last ticked this account (reminder idempotency). */
export interface RuntimeCursor {
  readonly lastTickAt: number | null;
}

/** Global cursor: when the weekly health check last ran. */
export interface HealthCursor {
  readonly lastRunAt: number | null;
}

export interface TickReport {
  readonly accountId: string;
  readonly appliedEvents: readonly string[];
  readonly finalState: State;
  readonly remindersSent: number;
}

/** A durable audit sink per account — the trail is per-account (invariant 7). */
export type AuditSinkFactory = (accountId: string) => AuditSink;

export interface SchedulerOptions {
  readonly machines: MachineRepository;
  /** Backing store for the worker's own cursors (kept apart from account state). */
  readonly cursorStore: KeyValueStore;
  readonly auditFor: AuditSinkFactory;
  readonly reminderSender: ReminderSender;
  readonly alertSender?: AlertSender;
  /** Dependency probers for the weekly health check (§6). Omit to disable health ticks. */
  readonly probers?: Record<Dependency, Prober>;
}

export class Scheduler {
  private readonly machines: MachineRepository;
  private readonly auditFor: AuditSinkFactory;
  private readonly reminderSender: ReminderSender;
  private readonly alertSender: AlertSender | undefined;
  private readonly probers: Record<Dependency, Prober> | undefined;
  private readonly cursors: SnapshotRepository<RuntimeCursor>;
  private readonly healthCursor: SnapshotRepository<HealthCursor>;

  constructor(options: SchedulerOptions) {
    this.machines = options.machines;
    this.auditFor = options.auditFor;
    this.reminderSender = options.reminderSender;
    this.alertSender = options.alertSender;
    this.probers = options.probers;
    this.cursors = new SnapshotRepository<RuntimeCursor>(options.cursorStore, 'runtime-cursor');
    this.healthCursor = new SnapshotRepository<HealthCursor>(options.cursorStore, 'health-cursor');
  }

  /**
   * Advance one account's timers and send its due cadence reminders. Returns
   * null if the account has no persisted machine yet.
   */
  tickAccount(accountId: string, now: number): TickReport | null {
    const machine = this.machines.load(accountId, this.auditFor(accountId));
    if (machine === undefined) return null;

    const cursor = this.cursors.get(accountId) ?? { lastTickAt: null };
    const windowStart = cursor.lastTickAt ?? Number.NEGATIVE_INFINITY;

    // 1. Cadence reminders for the phase at tick start (static copy only).
    const remindersSent = this.sendDueReminders(accountId, machine, windowStart, now);

    // 2. Advance forward-only timers through the guarded transition. A rejected
    //    step stops the loop and leaves the account unchanged (fail safe).
    const appliedEvents: string[] = [];
    for (let step = 0; step < MAX_ADVANCE_STEPS; step++) {
      const event = nextDueEvent(machine.context, now);
      if (event === null) break;
      const result = machine.apply(event);
      if (!result.ok) break;
      appliedEvents.push(event.type);
      this.machines.save(accountId, machine);
    }

    // 3. Record the tick so reminders are not re-sent and catch-up is bounded.
    this.cursors.save(accountId, { lastTickAt: now });

    return { accountId, appliedEvents, finalState: machine.state, remindersSent };
  }

  private sendDueReminders(accountId: string, machine: Machine, windowStart: number, now: number): number {
    const reminders = dueReminders(machine.context, windowStart, now);
    if (reminders.length === 0) return 0;
    const daysRemaining = holdDaysRemaining(machine.context, now);
    let sent = 0;
    for (const reminder of reminders) {
      const body = renderReminderBody(reminder.templateId, { daysRemaining, checkInDueDays: 0 });
      for (const channel of reminder.channels) {
        this.reminderSender.send({ accountId, channel, templateId: reminder.templateId, day: reminder.day, body });
        sent += 1;
      }
    }
    return sent;
  }

  /**
   * Run the weekly system health check if it is due, feed the result into every
   * account's dependency-health gate (veto path 3: an unhealthy stack blocks
   * entry to VERIFYING and starting a HOLD), and alert on failures. Returns the
   * report, or null if no probers are configured or the check is not yet due.
   */
  tickHealth(now: number): HealthReport | null {
    if (this.probers === undefined) return null;
    const cursor = this.healthCursor.get('global') ?? { lastRunAt: null };
    if (!isHealthCheckDue(cursor.lastRunAt, now)) return null;

    const report = runHealthCheck(this.probers, now);
    for (const accountId of this.machines.ids()) {
      const machine = this.machines.load(accountId, this.auditFor(accountId));
      if (machine === undefined) continue;
      applyHealthToMachine(machine, report, now);
      this.machines.save(accountId, machine);
    }
    if (!report.allOk && this.alertSender !== undefined) {
      for (const message of healthAlerts(report)) {
        this.alertSender.alert({ at: now, message });
      }
    }
    this.healthCursor.save('global', { lastRunAt: now });
    return report;
  }

  /** Run all due work: the health check first, then every account's timers. */
  runDueWork(now: number): TickReport[] {
    this.tickHealth(now);
    const reports: TickReport[] = [];
    for (const accountId of this.machines.ids()) {
      const report = this.tickAccount(accountId, now);
      if (report !== null) reports.push(report);
    }
    return reports;
  }
}
