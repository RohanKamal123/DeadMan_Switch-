// Decided timer values. EVERY constant below traces to a settled decision in
// PRODUCT_SPEC.md or DECISIONS.md — see the reference on each line. CLAUDE.md
// forbids introducing a timer, threshold, or delay that the spec does not
// specify; if you are tempted to add one here and cannot cite a decision,
// stop and ask instead.

import type { EvidenceMode } from './states';

export const DAY_MS = 24 * 60 * 60 * 1000;
export const HOUR_MS = 60 * 60 * 1000;

/** Weekly check-in cadence (PRODUCT_SPEC.md §3 "primary, weekly"; §NUDGE day-7). */
export const CHECK_IN_PERIOD_DAYS = 7;

/** Weekly automated system health check (PRODUCT_SPEC.md §6 "weekly"; DECISIONS.md 3.2). */
export const HEALTH_CHECK_PERIOD_DAYS = 7;

/**
 * Day the account leaves NUDGE for VERIFYING (PRODUCT_SPEC.md §NUDGE "Exit to
 * VERIFYING at day 30"). This is the invariant-2 boundary: no third party is
 * contacted before this day.
 */
export const VERIFYING_THRESHOLD_DAYS = 30;

/** HOLD cancel-window lengths (PRODUCT_SPEC.md §HOLD; DECISIONS.md 0.1). */
export const HOLD_LENIENT_DAYS = 30;
export const HOLD_STRICT_DAYS = 21;

/** PUBLIC_RELEASE occurs this long after PRIVATE_RELEASE (PRODUCT_SPEC.md §PUBLIC_RELEASE). */
export const PUBLIC_RELEASE_DELAY_DAYS = 14;

/** Recipient fallback after silence (DECISIONS.md 11.4). */
export const RECIPIENT_FALLBACK_DAYS = 14;

/** One-time release code expiry (PRODUCT_SPEC.md §PRIVATE_RELEASE; DECISIONS.md 4.2). */
export const CODE_EXPIRY_HOURS = 72;

/** Soft-delete grace before hard delete (DECISIONS.md 5.2 / 11.3). */
export const SOFT_DELETE_GRACE_DAYS = 7;

/** Post-release retention before permanent purge (DECISIONS.md 5.1). */
export const POST_RELEASE_RETENTION_DAYS = 30;

/**
 * Audit-log metadata retention horizon (DECISIONS.md 5.3: "metadata only,
 * retained 2 years"). 730 days = 2 years. The horizon depends on the launch
 * jurisdiction (1.1, Bangladesh) and is to be confirmed with counsel; change
 * only by explicit decision, never silently.
 */
export const AUDIT_RETENTION_DAYS = 730;

/** Quorum thresholds (DECISIONS.md 10.2; PRODUCT_SPEC.md invariant 4). */
export const QUORUM_MIN_CONFIRMATIONS = 3;
export const QUORUM_MIN_DISTINCT_GROUPS = 3;

/** HOLD window in days for the account's evidence mode (PRODUCT_SPEC.md §HOLD). */
export function holdWindowDays(mode: EvidenceMode): number {
  return mode === 'strict' ? HOLD_STRICT_DAYS : HOLD_LENIENT_DAYS;
}

export function days(n: number): number {
  return n * DAY_MS;
}
