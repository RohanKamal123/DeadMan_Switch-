// Core domain vocabulary for the Legacy Vault state machine.
//
// Source of truth: PRODUCT_SPEC.md §2 (the eight states) and §4 (groups /
// evidence modes). Nothing here invents a value; each maps to the spec.

/**
 * The eight states of the machine (PRODUCT_SPEC.md §2). The order is the
 * lifecycle order and is not otherwise significant.
 */
export const STATES = [
  'ACTIVE',
  'NUDGE',
  'VERIFYING',
  'STALLED',
  'HOLD',
  'PRIVATE_RELEASE',
  'PUBLIC_RELEASE',
  'CANCELLED',
] as const;

export type State = (typeof STATES)[number];

/**
 * States in which content release is pending or done. Content authoring is
 * frozen here (UX_SPEC.md §1.4: "edits stop being possible once a hold is
 * running"). Also the states from which STALLED must never be reachable
 * except by an explicit, audited operator/user action.
 */
export const RELEASE_PENDING_STATES: readonly State[] = [
  'HOLD',
  'PRIVATE_RELEASE',
  'PUBLIC_RELEASE',
];

/**
 * The states that represent, or advance toward, a content release
 * (PRODUCT_SPEC.md invariant 5). STALLED must never reach any of these
 * without a deliberate, audited transition back through VERIFYING.
 */
export const RELEASE_ADVANCING_STATES: readonly State[] = [
  'HOLD',
  'PRIVATE_RELEASE',
  'PUBLIC_RELEASE',
];

/** Trustee groups (PRODUCT_SPEC.md §4; DECISIONS.md 10.2). */
export const GROUPS = ['family', 'colleague', 'friend', 'other'] as const;
export type Group = (typeof GROUPS)[number];

/** Evidence modes chosen by the user at setup (PRODUCT_SPEC.md §4). */
export type EvidenceMode = 'lenient' | 'strict';

/** Per-contact / overall working state an operator records (DECISIONS.md 10.1). */
export type ContactState = 'alive' | 'deceased' | 'accident' | 'unknown';

export function isState(value: unknown): value is State {
  return typeof value === 'string' && (STATES as readonly string[]).includes(value);
}

export function isGroup(value: unknown): value is Group {
  return typeof value === 'string' && (GROUPS as readonly string[]).includes(value);
}
