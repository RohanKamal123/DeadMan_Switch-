// Quorum counting for death confirmations (PRODUCT_SPEC.md §4; DECISIONS.md
// 10.2 / 10.3). Pure functions only — no state is mutated here.

import { QUORUM_MIN_CONFIRMATIONS, QUORUM_MIN_DISTINCT_GROUPS } from './config';
import type { Group } from './states';

/**
 * A death confirmation recorded manually by an operator. The logged entry —
 * identity, group, recording operator, timestamp — is the trail; the phone
 * call or email only prompts (DECISIONS.md 4.1).
 */
export interface Confirmation {
  readonly contactId: string;
  readonly group: Group;
  readonly recordingOperatorId: string;
  readonly at: number;
}

export interface QuorumResult {
  /** True iff ≥3 confirmations come from ≥3 DISTINCT groups (invariant 4). */
  readonly met: boolean;
  readonly distinctGroups: number;
  readonly groups: readonly Group[];
  /** Distinct contacts whose confirmations were counted. */
  readonly countedContactIds: readonly string[];
}

export interface QuorumOptions {
  /**
   * Self-dealing guard (DECISIONS.md 10.3): when counting quorum for a release
   * that DELIVERS to this contact, that contact's own confirmation must not be
   * counted toward releasing to themselves. The confirmation is not deleted —
   * it is simply excluded from this count.
   */
  readonly excludeContactId?: string;
}

/**
 * Count quorum over a set of confirmations.
 *
 * Quorum is defined by DISTINCT GROUPS, not a raw count: two confirmations
 * from the same group count as one group, and the same contact appearing more
 * than once (the "one person, several phones" attack) contributes a single
 * group. Because there are four groups, "≥3 distinct groups" already implies
 * "≥3 confirmations", but both thresholds are checked explicitly.
 */
export function computeQuorum(
  confirmations: readonly Confirmation[],
  options: QuorumOptions = {},
): QuorumResult {
  const excluded = options.excludeContactId;
  const counted = confirmations.filter((c) => c.contactId !== excluded);

  const distinctContactIds = Array.from(new Set(counted.map((c) => c.contactId)));
  const groups = Array.from(new Set(counted.map((c) => c.group)));

  const met =
    distinctContactIds.length >= QUORUM_MIN_CONFIRMATIONS &&
    groups.length >= QUORUM_MIN_DISTINCT_GROUPS;

  return {
    met,
    distinctGroups: groups.length,
    groups,
    countedContactIds: distinctContactIds,
  };
}
