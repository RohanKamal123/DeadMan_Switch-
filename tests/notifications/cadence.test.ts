// Notification cadence (PRODUCT_SPEC.md §NUDGE / §HOLD). The day schedules are
// decided values; the cadence module renders them, it does not invent them.

import {
  nudgeSchedule,
  holdCancelSchedule,
  remindersDueOn,
} from '../../src/notifications/cadence';

describe('NUDGE cadence (§NUDGE)', () => {
  it('reminds on days 7, 14, 21 only', () => {
    expect(nudgeSchedule().map((r) => r.day)).toEqual([7, 14, 21]);
  });

  it('day 7 is in-app only; no third party (invariant 2)', () => {
    const day7 = remindersDueOn(nudgeSchedule(), 7);
    expect(day7?.channels).toEqual(['in-app']);
  });

  it('day 14 adds email + SMS, day 21 secondary device + backup email', () => {
    expect(remindersDueOn(nudgeSchedule(), 14)?.channels).toEqual(['email', 'sms']);
    expect(remindersDueOn(nudgeSchedule(), 21)?.channels).toEqual(['push-secondary', 'email-backup']);
  });

  it('has nothing due on a non-cadence day', () => {
    expect(remindersDueOn(nudgeSchedule(), 10)).toBeUndefined();
  });
});

describe('HOLD cancel-prompt cadence (§HOLD)', () => {
  it('strict (21-day) prompts on days 1, 7, 14, 19, 20, 21', () => {
    expect(holdCancelSchedule('strict').map((r) => r.day)).toEqual([1, 7, 14, 19, 20, 21]);
  });

  it('lenient (30-day) adds days 25, 28, 29, 30', () => {
    expect(holdCancelSchedule('lenient').map((r) => r.day)).toEqual([1, 7, 14, 19, 20, 21, 25, 28, 29, 30]);
  });

  it('every HOLD prompt reaches every cancel channel (§HOLD)', () => {
    for (const r of holdCancelSchedule('lenient')) {
      expect(r.channels).toEqual(
        expect.arrayContaining(['push', 'sms', 'email', 'email-secondary', 'email-backup', 'push-secondary']),
      );
    }
  });

  it('the last lenient prompt lands on the final day of the window', () => {
    const last = holdCancelSchedule('lenient').at(-1);
    expect(last?.day).toBe(30);
  });
});
