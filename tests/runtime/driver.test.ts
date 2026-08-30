// Phase E — the scheduler driver (DECISIONS.md §12). It ticks the pure worker on
// a clock and, above all, fails SAFE: a throw inside a tick is caught so one bad
// account never freezes the whole fleet's timers (invariant 5).

import { SchedulerDriver } from '../../src/runtime/driver';
import type { Scheduler, TickReport } from '../../src/runtime/scheduler';

/** A stub scheduler whose `runDueWork` is controllable. */
function stubScheduler(impl: (now: number) => TickReport[]): { scheduler: Scheduler; calls: number[] } {
  const calls: number[] = [];
  const scheduler = {
    runDueWork: (now: number): TickReport[] => {
      calls.push(now);
      return impl(now);
    },
  } as unknown as Scheduler;
  return { scheduler, calls };
}

describe('SchedulerDriver', () => {
  afterEach(() => jest.useRealTimers());

  it('requires a positive interval', () => {
    const { scheduler } = stubScheduler(() => []);
    expect(() => new SchedulerDriver({ scheduler, intervalMs: 0 })).toThrow();
    expect(() => new SchedulerDriver({ scheduler, intervalMs: -5 })).toThrow();
  });

  it('runOnce ticks the scheduler with the injected clock and reports back', () => {
    const report: TickReport = { accountId: 'a', appliedEvents: [], finalState: 'ACTIVE', remindersSent: 0 };
    const { scheduler, calls } = stubScheduler(() => [report]);
    const seen: TickReport[][] = [];
    const driver = new SchedulerDriver({ scheduler, intervalMs: 1000, now: () => 4242, onTick: (r) => seen.push([...r]) });
    const out = driver.runOnce();
    expect(calls).toEqual([4242]);
    expect(out).toEqual([report]);
    expect(seen).toEqual([[report]]);
  });

  it('catches a throw inside a tick and reports it, without propagating (fail safe)', () => {
    const { scheduler } = stubScheduler(() => {
      throw new Error('store unavailable');
    });
    const errors: unknown[] = [];
    const driver = new SchedulerDriver({ scheduler, intervalMs: 1000, onError: (e) => errors.push(e) });
    expect(() => driver.runOnce()).not.toThrow();
    expect(driver.runOnce()).toEqual([]);
    expect(errors).toHaveLength(2);
    expect((errors[0] as Error).message).toBe('store unavailable');
  });

  it('start ticks immediately and then every interval; stop halts', () => {
    jest.useFakeTimers();
    const { scheduler, calls } = stubScheduler(() => []);
    const driver = new SchedulerDriver({ scheduler, intervalMs: 1000, now: () => 0 });

    driver.start();
    expect(driver.running).toBe(true);
    expect(calls).toHaveLength(1); // immediate catch-up tick

    jest.advanceTimersByTime(3000);
    expect(calls).toHaveLength(4); // + three interval ticks

    driver.stop();
    expect(driver.running).toBe(false);
    jest.advanceTimersByTime(5000);
    expect(calls).toHaveLength(4); // no more ticks after stop
  });

  it('start and stop are idempotent (no double interval)', () => {
    jest.useFakeTimers();
    const { scheduler, calls } = stubScheduler(() => []);
    const driver = new SchedulerDriver({ scheduler, intervalMs: 1000, now: () => 0 });

    driver.start();
    driver.start(); // no-op
    expect(calls).toHaveLength(1);
    jest.advanceTimersByTime(1000);
    expect(calls).toHaveLength(2); // one interval, not two

    driver.stop();
    driver.stop(); // no-op
    expect(driver.running).toBe(false);
  });
});
