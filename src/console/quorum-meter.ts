// Read-models the operator console shows around quorum (UX_SPEC.md §3.3 / §3.4).
// These are pure derivations over the machine's confirmations — they never
// change state. The machine's START_HOLD guard remains the source of truth;
// these exist so the UI can explain a disabled button and surface self-dealing.

import { GROUPS, type Group, type State } from '../domain/states';
import { QUORUM_MIN_DISTINCT_GROUPS } from '../domain/config';
import { computeQuorum, type Confirmation } from '../domain/quorum';

export interface GroupProgress {
  readonly group: Group;
  readonly confirmed: boolean;
  readonly contactIds: readonly string[];
}

export interface QuorumMeterView {
  readonly met: boolean;
  readonly distinctGroups: number;
  readonly requiredGroups: number;
  readonly missingGroups: number;
  /** All four groups, each with whether it has a confirmation. */
  readonly groups: readonly GroupProgress[];
}

export function quorumMeter(
  confirmations: readonly Confirmation[],
  options: { excludeContactId?: string } = {},
): QuorumMeterView {
  const excluded = options.excludeContactId;
  const counted = confirmations.filter((c) => c.contactId !== excluded);

  const groups: GroupProgress[] = GROUPS.map((group) => {
    const inGroup = counted.filter((c) => c.group === group);
    return {
      group,
      confirmed: inGroup.length > 0,
      contactIds: Array.from(new Set(inGroup.map((c) => c.contactId))),
    };
  });

  const result = computeQuorum(confirmations, options);
  return {
    met: result.met,
    distinctGroups: result.distinctGroups,
    requiredGroups: QUORUM_MIN_DISTINCT_GROUPS,
    missingGroups: Math.max(0, QUORUM_MIN_DISTINCT_GROUPS - result.distinctGroups),
    groups,
  };
}

export interface RecipientEligibilityView {
  readonly recipientId: string;
  readonly deliverable: boolean;
  readonly reason: string | null;
}

/**
 * Self-dealing guard (DECISIONS.md 10.3): a person's own confirmation is never
 * counted toward a release that delivers to that same person. Quorum for
 * delivering to `recipientId` is recomputed excluding their own confirmation.
 */
export function recipientEligibility(
  confirmations: readonly Confirmation[],
  recipientId: string,
): RecipientEligibilityView {
  const result = computeQuorum(confirmations, { excludeContactId: recipientId });
  return {
    recipientId,
    deliverable: result.met,
    reason: result.met
      ? null
      : "excluding the recipient's own confirmation, quorum is not met (self-dealing guard)",
  };
}

export interface HoldReadinessInput {
  readonly state: State;
  readonly confirmations: readonly Confirmation[];
  readonly dependencyHealthOk: boolean;
  readonly adminFrozen: boolean;
}

export interface HoldReadinessView {
  readonly canStart: boolean;
  /** Human-readable reasons the Start-HOLD action is disabled. Empty when ready. */
  readonly reasons: readonly string[];
}

export function holdStartReadiness(input: HoldReadinessInput): HoldReadinessView {
  const reasons: string[] = [];
  if (input.state !== 'VERIFYING') {
    reasons.push(`account is ${input.state}, not VERIFYING`);
  }
  const meter = quorumMeter(input.confirmations);
  if (!meter.met) {
    reasons.push(
      `need ${meter.missingGroups} more confirmation(s) from distinct groups (have ${meter.distinctGroups} of ${meter.requiredGroups})`,
    );
  }
  if (!input.dependencyHealthOk) {
    reasons.push('a critical dependency (email/SMS/storage) is unhealthy');
  }
  if (input.adminFrozen) {
    reasons.push('the account is frozen by an admin');
  }
  return { canStart: reasons.length === 0, reasons };
}
