// Phase E — the scheduler DRIVER (DECISIONS.md §12 Phase E).
//
// The `Scheduler` is a pure worker: `runDueWork(now)` advances every account's
// due timers and runs the weekly health check, once. Something has to CALL it on
// a clock — that is this driver. It owns no business logic and makes no decision;
// it only decides WHEN to tick, and it is built around one rule from the spec:
//
//   > A worker outage delays events; it never advances an account toward release
//   > (invariant 5; the one rule — being late is cheap, being wrong is not).
//
// So the driver fails SAFE by construction: a throw inside a tick is caught and
// reported, never propagated — one bad tick must not kill the loop and freeze the
// whole fleet's timers. Each tick re-derives everything from persisted state
// (Scheduler), so a missed or delayed tick is simply caught up on the next one;
// there is no accumulated in-memory state to lose. Ticking twice is harmless
// (transitions are idempotent at the guard, reminders are cursor-deduped), so a
// slow tick overlapping the next interval cannot double-fire anything.

import type { Scheduler, TickReport } from './scheduler';

export interface SchedulerDriverOptions {
  readonly scheduler: Scheduler;
  /** How often to run due work, in ms. Must be > 0. */
  readonly intervalMs: number;
  /** Clock; defaults to `Date.now`. Injectable for tests. */
  readonly now?: () => number;
  /** Called with every caught tick error. Never receives secrets. */
  readonly onError?: (error: unknown) => void;
  /** Called after each successful tick with its reports (observability). */
  readonly onTick?: (reports: readonly TickReport[]) => void;
}

/**
 * Runs a `Scheduler` on a fixed interval. `start` fires one tick immediately (so
 * a just-booted process catches up any work due while it was down) and then every
 * `intervalMs`. `stop` halts cleanly. `runOnce` performs a single guarded pass and
 * is the unit other code (or a test, or an ops "tick now" hook) can call directly.
 */
export class SchedulerDriver {
  private readonly scheduler: Scheduler;
  private readonly intervalMs: number;
  private readonly now: () => number;
  private readonly onError: ((error: unknown) => void) | undefined;
  private readonly onTick: ((reports: readonly TickReport[]) => void) | undefined;

  private handle: ReturnType<typeof setInterval> | null = null;

  constructor(options: SchedulerDriverOptions) {
    if (!(options.intervalMs > 0)) throw new Error('SchedulerDriver requires intervalMs > 0');
    this.scheduler = options.scheduler;
    this.intervalMs = options.intervalMs;
    this.now = options.now ?? Date.now;
    this.onError = options.onError;
    this.onTick = options.onTick;
  }

  /** True while the interval is armed. */
  get running(): boolean {
    return this.handle !== null;
  }

  /** Begin ticking. Idempotent: a second call while running is a no-op. Ticks once immediately. */
  start(): void {
    if (this.handle !== null) return;
    this.runOnce();
    this.handle = setInterval(() => this.runOnce(), this.intervalMs);
  }

  /** Stop ticking. Idempotent. */
  stop(): void {
    if (this.handle === null) return;
    clearInterval(this.handle);
    this.handle = null;
  }

  /**
   * One guarded pass of all due work. A throw is caught and reported — the loop
   * survives so a single failing account or a transient store error never freezes
   * the fleet's timers (fail safe: an outage delays, it never releases).
   */
  runOnce(): readonly TickReport[] {
    try {
      const reports = this.scheduler.runDueWork(this.now());
      this.onTick?.(reports);
      return reports;
    } catch (error) {
      this.onError?.(error);
      return [];
    }
  }
}
