// Notification cadence (PRODUCT_SPEC.md §NUDGE / §HOLD). Every day here is a
// decided value from the spec; this module renders the schedule, it never
// invents a cadence. NUDGE reaches only the user (invariant 2); HOLD prompts
// reach every cancel channel so a living user can always stop everything.

import type { EvidenceMode } from '../domain/states';

export type Channel =
  | 'in-app'
  | 'email'
  | 'sms'
  | 'push'
  | 'push-secondary'
  | 'email-secondary'
  | 'email-backup';

export interface ScheduledReminder {
  readonly day: number;
  readonly channels: readonly Channel[];
  readonly templateId: string;
}

/** §NUDGE: day 7 in-app, day 14 email+SMS, day 21 secondary device + backup email. */
export function nudgeSchedule(): ScheduledReminder[] {
  return [
    { day: 7, channels: ['in-app'], templateId: 'nudge.day7' },
    { day: 14, channels: ['email', 'sms'], templateId: 'nudge.day14' },
    { day: 21, channels: ['push-secondary', 'email-backup'], templateId: 'nudge.day21' },
  ];
}

// §HOLD: every cancel prompt reaches push, SMS, primary email, all secondary
// emails, backup email, and the secondary device.
const HOLD_CHANNELS: readonly Channel[] = [
  'push',
  'sms',
  'email',
  'email-secondary',
  'email-backup',
  'push-secondary',
];

// §HOLD cadence: days 1, 7, 14, 19, 20, 21 (and 25, 28, 29, 30 in lenient mode).
const HOLD_BASE_DAYS = [1, 7, 14, 19, 20, 21];
const HOLD_LENIENT_EXTRA_DAYS = [25, 28, 29, 30];

export function holdCancelSchedule(mode: EvidenceMode): ScheduledReminder[] {
  const days = mode === 'lenient' ? [...HOLD_BASE_DAYS, ...HOLD_LENIENT_EXTRA_DAYS] : HOLD_BASE_DAYS;
  return days.map((day) => ({ day, channels: HOLD_CHANNELS, templateId: 'hold.cancelPrompt' }));
}

export function remindersDueOn(
  schedule: readonly ScheduledReminder[],
  day: number,
): ScheduledReminder | undefined {
  return schedule.find((r) => r.day === day);
}
