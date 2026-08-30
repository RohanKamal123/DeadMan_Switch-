// Phase E — the pure due-event planner. It must propose exactly the forward
// timer events and NEVER anything out of VERIFYING or STALLED (invariant 5).

import {
  CHECK_IN_PERIOD_DAYS,
  HOLD_LENIENT_DAYS,
  PUBLIC_RELEASE_DELAY_DAYS,
  VERIFYING_THRESHOLD_DAYS,
} from '../../src/domain/config';
import {
  SYSTEM_ACTOR,
  dueReminders,
  holdDaysRemaining,
  isHealthCheckDue,
  nextDueEvent,
} from '../../src/runtime';
import { T0, daysAfter, machineIn } from '../support/factory';

describe('nextDueEvent — forward timers', () => {
  it('ACTIVE fires MISSED_CHECK_IN once the check-in period lapses', () => {
    const ctx = machineIn('ACTIVE', { lastLivenessAt: T0 });
    expect(nextDueEvent(ctx, daysAfter(T0, CHECK_IN_PERIOD_DAYS - 1))).toBeNull();
    expect(nextDueEvent(ctx, daysAfter(T0, CHECK_IN_PERIOD_DAYS))).toEqual({
      type: 'MISSED_CHECK_IN',
      at: daysAfter(T0, CHECK_IN_PERIOD_DAYS),
    });
  });

  it('NUDGE fires REACH_VERIFYING at the day-30 threshold', () => {
    const ctx = machineIn('NUDGE', { lastLivenessAt: T0 });
    expect(nextDueEvent(ctx, daysAfter(T0, VERIFYING_THRESHOLD_DAYS - 1))).toBeNull();
    expect(nextDueEvent(ctx, daysAfter(T0, VERIFYING_THRESHOLD_DAYS))).toEqual({
      type: 'REACH_VERIFYING',
      at: daysAfter(T0, VERIFYING_THRESHOLD_DAYS),
    });
  });

  it('HOLD fires TRIGGER_PRIVATE_RELEASE only after the full window, with the system actor', () => {
    const holdStartedAt = daysAfter(T0, 31);
    const ctx = machineIn('HOLD', { holdStartedAt });
    expect(nextDueEvent(ctx, daysAfter(holdStartedAt, HOLD_LENIENT_DAYS - 1))).toBeNull();
    expect(nextDueEvent(ctx, daysAfter(holdStartedAt, HOLD_LENIENT_DAYS))).toEqual({
      type: 'TRIGGER_PRIVATE_RELEASE',
      at: daysAfter(holdStartedAt, HOLD_LENIENT_DAYS),
      operatorId: SYSTEM_ACTOR,
    });
  });

  it('PRIVATE_RELEASE fires public release only when enabled and after the 14-day delay', () => {
    const privateReleasedAt = daysAfter(T0, 62);
    const disabled = machineIn('PRIVATE_RELEASE', { privateReleasedAt, publicReleaseEnabled: false });
    expect(nextDueEvent(disabled, daysAfter(privateReleasedAt, PUBLIC_RELEASE_DELAY_DAYS))).toBeNull();

    const enabled = machineIn('PRIVATE_RELEASE', { privateReleasedAt, publicReleaseEnabled: true });
    expect(nextDueEvent(enabled, daysAfter(privateReleasedAt, PUBLIC_RELEASE_DELAY_DAYS - 1))).toBeNull();
    expect(nextDueEvent(enabled, daysAfter(privateReleasedAt, PUBLIC_RELEASE_DELAY_DAYS))).toEqual({
      type: 'TRIGGER_PUBLIC_RELEASE',
      at: daysAfter(privateReleasedAt, PUBLIC_RELEASE_DELAY_DAYS),
      operatorId: SYSTEM_ACTOR,
    });
  });
});

describe('nextDueEvent — never auto-advances the human-gated or terminal states', () => {
  it.each(['VERIFYING', 'STALLED', 'CANCELLED', 'PUBLIC_RELEASE'] as const)(
    'proposes nothing from %s no matter how much time passes (invariant 5)',
    (state) => {
      const ctx = machineIn(state);
      expect(nextDueEvent(ctx, daysAfter(T0, 3650))).toBeNull();
    },
  );
});

describe('dueReminders', () => {
  it('emits NUDGE reminders on their scheduled days, measured from last liveness', () => {
    const ctx = machineIn('NUDGE', { lastLivenessAt: T0 });
    // First tick (windowStart = -Infinity) at day 15 catches days 7 and 14.
    const due = dueReminders(ctx, Number.NEGATIVE_INFINITY, daysAfter(T0, 15));
    expect(due.map((r) => r.day)).toEqual([7, 14]);
  });

  it('does not re-emit a reminder already covered by the previous tick window', () => {
    const ctx = machineIn('NUDGE', { lastLivenessAt: T0 });
    const due = dueReminders(ctx, daysAfter(T0, 14), daysAfter(T0, 22));
    expect(due.map((r) => r.day)).toEqual([21]);
  });

  it('emits HOLD cancel prompts measured from the HOLD start', () => {
    const holdStartedAt = daysAfter(T0, 31);
    const ctx = machineIn('HOLD', { holdStartedAt });
    const due = dueReminders(ctx, Number.NEGATIVE_INFINITY, daysAfter(holdStartedAt, 7));
    expect(due.map((r) => r.day)).toEqual([1, 7]);
    expect(due.every((r) => r.templateId === 'hold.cancelPrompt')).toBe(true);
  });

  it('emits nothing for a phase without a cadence (e.g. ACTIVE, VERIFYING)', () => {
    expect(dueReminders(machineIn('ACTIVE'), Number.NEGATIVE_INFINITY, daysAfter(T0, 100))).toEqual([]);
    expect(dueReminders(machineIn('VERIFYING'), Number.NEGATIVE_INFINITY, daysAfter(T0, 100))).toEqual([]);
  });
});

describe('holdDaysRemaining', () => {
  it('counts down the HOLD window and never goes negative', () => {
    const holdStartedAt = daysAfter(T0, 31);
    const ctx = machineIn('HOLD', { holdStartedAt });
    expect(holdDaysRemaining(ctx, daysAfter(holdStartedAt, 1))).toBe(HOLD_LENIENT_DAYS - 1);
    expect(holdDaysRemaining(ctx, daysAfter(holdStartedAt, HOLD_LENIENT_DAYS + 5))).toBe(0);
  });
});

describe('isHealthCheckDue', () => {
  it('is due when never run, and weekly thereafter', () => {
    expect(isHealthCheckDue(null, T0)).toBe(true);
    expect(isHealthCheckDue(T0, daysAfter(T0, 6))).toBe(false);
    expect(isHealthCheckDue(T0, daysAfter(T0, 7))).toBe(true);
  });
});
