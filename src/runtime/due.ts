// The pure heart of the Phase E worker (DECISIONS.md §12 Phase E). Given a
// persisted machine context and the current time, decide what timer event is
// due — and nothing more. No IO, no state mutation: the scheduler applies the
// returned event through the guarded `transition`, so every invariant still
// holds and the worker can never advance past a guard.
//
// FAIL-SAFE BY CONSTRUCTION (invariant 5; DECISIONS.md 7.3): this planner only
// ever proposes events that move a lapsed account FORWARD along the deterministic
// timeline. It NEVER proposes an event out of VERIFYING or STALLED — reaching
// quorum, starting a HOLD, or marking a case is a deliberate human action, never
// a timer. A worker outage therefore delays events; it can never manufacture the
// operator decisions that a release depends on.

import {
  CHECK_IN_PERIOD_DAYS,
  DAY_MS,
  HEALTH_CHECK_PERIOD_DAYS,
  PUBLIC_RELEASE_DELAY_DAYS,
  VERIFYING_THRESHOLD_DAYS,
  holdWindowDays,
} from '../domain/config';
import type { Event, MachineContext } from '../domain/transition';
import {
  holdCancelSchedule,
  nudgeSchedule,
  type Channel,
  type ScheduledReminder,
} from '../notifications/cadence';

/**
 * The audit actor for a worker-fired transition. A worker-fired release is the
 * deterministic timer firing (DECISIONS.md 0.1: release is the automatic
 * consequence of an elapsed HOLD with no cancel) — the actor is recorded
 * truthfully as the system, never a human operator.
 */
export const SYSTEM_ACTOR = 'system:scheduler';

function elapsedDays(from: number, to: number): number {
  return (to - from) / DAY_MS;
}

/**
 * The single timer event due for this context now, or null if none is. Applying
 * it advances the machine; re-calling on the new context yields the next due
 * event (so a worker that missed several days catches up one guarded step at a
 * time, e.g. ACTIVE → NUDGE → VERIFYING).
 */
export function nextDueEvent(ctx: MachineContext, now: number): Event | null {
  switch (ctx.state) {
    case 'ACTIVE':
      // Day 7: the check-in lapsed → NUDGE (user-only reminders begin).
      if (elapsedDays(ctx.lastLivenessAt, now) >= CHECK_IN_PERIOD_DAYS) {
        return { type: 'MISSED_CHECK_IN', at: now };
      }
      return null;

    case 'NUDGE':
      // Day 30: flag the operator queue → VERIFYING. The guard still enforces
      // invariant 2 and the dependency-health / freeze vetoes; if it rejects,
      // the scheduler simply does not advance (fail safe).
      if (elapsedDays(ctx.lastLivenessAt, now) >= VERIFYING_THRESHOLD_DAYS) {
        return { type: 'REACH_VERIFYING', at: now };
      }
      return null;

    case 'HOLD':
      // The HOLD window has fully elapsed with no cancel → private release. The
      // guard re-checks the window, quorum, and (strict mode) the certificate,
      // so the worker can never release early or without quorum.
      if (
        ctx.holdStartedAt !== null &&
        elapsedDays(ctx.holdStartedAt, now) >= holdWindowDays(ctx.evidenceMode)
      ) {
        return { type: 'TRIGGER_PRIVATE_RELEASE', at: now, operatorId: SYSTEM_ACTOR };
      }
      return null;

    case 'PRIVATE_RELEASE':
      // The 14-day public-release delay has elapsed, and only if the user opted
      // in (the guard enforces `publicReleaseEnabled` too).
      if (
        ctx.publicReleaseEnabled &&
        ctx.privateReleasedAt !== null &&
        elapsedDays(ctx.privateReleasedAt, now) >= PUBLIC_RELEASE_DELAY_DAYS
      ) {
        return { type: 'TRIGGER_PUBLIC_RELEASE', at: now, operatorId: SYSTEM_ACTOR };
      }
      return null;

    // VERIFYING and STALLED are operator-driven and MUST NOT be auto-advanced
    // (invariant 5). CANCELLED and PUBLIC_RELEASE are terminal for the worker.
    case 'VERIFYING':
    case 'STALLED':
    case 'CANCELLED':
    case 'PUBLIC_RELEASE':
      return null;

    default: {
      const _never: never = ctx.state;
      return _never;
    }
  }
}

// --- cadence reminders ------------------------------------------------------

export interface DueReminder {
  readonly day: number;
  readonly channels: readonly Channel[];
  readonly templateId: string;
  /** Absolute time this reminder is scheduled for (anchor + day). */
  readonly dueAt: number;
}

function scheduleForPhase(ctx: MachineContext): { schedule: readonly ScheduledReminder[]; anchor: number } | null {
  if (ctx.state === 'NUDGE') {
    // NUDGE reminder days are measured from the last liveness signal (§NUDGE).
    return { schedule: nudgeSchedule(), anchor: ctx.lastLivenessAt };
  }
  if (ctx.state === 'HOLD' && ctx.holdStartedAt !== null) {
    // HOLD cancel-prompt days are measured from when the HOLD started (§HOLD).
    return { schedule: holdCancelSchedule(ctx.evidenceMode), anchor: ctx.holdStartedAt };
  }
  return null;
}

/**
 * Reminders whose scheduled time falls in `(windowStart, now]` for the phase the
 * context is in. `windowStart` is the worker's last tick time (or -Infinity on
 * the first tick), so each reminder is emitted once and a worker that missed
 * ticks re-derives and catches up the backlog from persisted state.
 */
export function dueReminders(ctx: MachineContext, windowStart: number, now: number): DueReminder[] {
  const phase = scheduleForPhase(ctx);
  if (phase === null) return [];
  return phase.schedule
    .map((r) => ({ day: r.day, channels: r.channels, templateId: r.templateId, dueAt: phase.anchor + r.day * DAY_MS }))
    .filter((r) => r.dueAt > windowStart && r.dueAt <= now);
}

/** Days left in a running HOLD window, for the cancel-prompt template copy. */
export function holdDaysRemaining(ctx: MachineContext, now: number): number {
  if (ctx.state !== 'HOLD' || ctx.holdStartedAt === null) return 0;
  const remaining = holdWindowDays(ctx.evidenceMode) - elapsedDays(ctx.holdStartedAt, now);
  return Math.max(0, Math.ceil(remaining));
}

// --- weekly health check ----------------------------------------------------

/** The weekly system health check is due if it has never run or a week has passed (§6). */
export function isHealthCheckDue(lastRunAt: number | null, now: number): boolean {
  if (lastRunAt === null) return true;
  return elapsedDays(lastRunAt, now) >= HEALTH_CHECK_PERIOD_DAYS;
}
