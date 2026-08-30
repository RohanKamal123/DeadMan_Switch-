// Test-only helpers for constructing a MachineContext in an arbitrary state.
//
// These bypass the guarded transition function on purpose: unit tests for the
// pure transition need to start the machine in a given state without replaying
// a whole history. Production code must never construct a MachineContext this
// way — state is only ever reached through `transition`.

import { DAY_MS } from '../../src/domain/config';
import type { State } from '../../src/domain/states';
import type { Confirmation } from '../../src/domain/quorum';
import type { MachineContext } from '../../src/domain/transition';

export const T0 = 1_700_000_000_000; // fixed epoch for deterministic tests

export function daysAfter(base: number, n: number): number {
  return base + n * DAY_MS;
}

/** Three confirmations from three distinct groups — the minimum quorum. */
export function quorumConfirmations(at = T0): Confirmation[] {
  return [
    { contactId: 'c-family', group: 'family', recordingOperatorId: 'op-1', at },
    { contactId: 'c-friend', group: 'friend', recordingOperatorId: 'op-1', at },
    { contactId: 'c-colleague', group: 'colleague', recordingOperatorId: 'op-1', at },
  ];
}

const BASE: MachineContext = {
  state: 'ACTIVE',
  evidenceMode: 'lenient',
  publicReleaseEnabled: false,
  lastLivenessAt: T0,
  nudgeStartedAt: null,
  verifyingStartedAt: null,
  holdStartedAt: null,
  privateReleasedAt: null,
  publicReleasedAt: null,
  confirmations: [],
  deathCertificateUploaded: false,
  dependencyHealthOk: true,
  adminFrozen: false,
};

/**
 * Build a MachineContext resting in `state`, with the timers/confirmations
 * that state would plausibly carry, overridable per field.
 */
export function machineIn(
  state: State,
  overrides: Partial<MachineContext> = {},
): MachineContext {
  let base: MachineContext = { ...BASE, state };
  switch (state) {
    case 'NUDGE':
      base = { ...base, nudgeStartedAt: daysAfter(T0, 7), lastLivenessAt: T0 };
      break;
    case 'VERIFYING':
      base = {
        ...base,
        nudgeStartedAt: daysAfter(T0, 7),
        verifyingStartedAt: daysAfter(T0, 30),
        lastLivenessAt: T0,
        confirmations: quorumConfirmations(daysAfter(T0, 31)),
      };
      break;
    case 'STALLED':
      base = { ...base, verifyingStartedAt: daysAfter(T0, 30), lastLivenessAt: T0 };
      break;
    case 'HOLD':
      base = {
        ...base,
        holdStartedAt: daysAfter(T0, 31),
        lastLivenessAt: T0,
        confirmations: quorumConfirmations(daysAfter(T0, 31)),
      };
      break;
    case 'PRIVATE_RELEASE':
      base = {
        ...base,
        holdStartedAt: daysAfter(T0, 31),
        privateReleasedAt: daysAfter(T0, 62),
        lastLivenessAt: T0,
        confirmations: quorumConfirmations(daysAfter(T0, 31)),
      };
      break;
    case 'PUBLIC_RELEASE':
      base = {
        ...base,
        holdStartedAt: daysAfter(T0, 31),
        privateReleasedAt: daysAfter(T0, 62),
        publicReleasedAt: daysAfter(T0, 76),
        publicReleaseEnabled: true,
        lastLivenessAt: T0,
        confirmations: quorumConfirmations(daysAfter(T0, 31)),
      };
      break;
    case 'CANCELLED':
      base = { ...base, lastLivenessAt: daysAfter(T0, 5) };
      break;
    default:
      break;
  }
  return { ...base, ...overrides };
}
