// The single guarded transition function. EVERY state change in the system
// goes through `transition` — there are no ad-hoc status writes anywhere else
// (CLAUDE.md working style). The function is pure: it never mutates its input
// and never performs IO. It returns either an accepted result (a new machine,
// the effects to perform, and the audit entry to log) or a rejection with the
// input machine unchanged.
//
// The seven invariants (PRODUCT_SPEC.md §9) are enforced here as guards. When a
// design question is ambiguous, the conservative (slower, non-releasing) branch
// is taken — being wrong is worse than being slow.

import {
  DAY_MS,
  CHECK_IN_PERIOD_DAYS,
  VERIFYING_THRESHOLD_DAYS,
  PUBLIC_RELEASE_DELAY_DAYS,
  holdWindowDays,
} from './config';
import { computeQuorum, type Confirmation } from './quorum';
import type { AuditEntryInput, Metadata } from './audit';
import type { EvidenceMode, State } from './states';

export interface MachineContext {
  readonly state: State;
  readonly evidenceMode: EvidenceMode;
  readonly publicReleaseEnabled: boolean;
  /** Reset to the signal time on any liveness signal (PRODUCT_SPEC.md §3). */
  readonly lastLivenessAt: number;
  readonly nudgeStartedAt: number | null;
  readonly verifyingStartedAt: number | null;
  readonly holdStartedAt: number | null;
  readonly privateReleasedAt: number | null;
  readonly publicReleasedAt: number | null;
  readonly confirmations: readonly Confirmation[];
  readonly deathCertificateUploaded: boolean;
  readonly dependencyHealthOk: boolean;
  readonly adminFrozen: boolean;
}

export type Effect =
  | 'WIPE_CONFIRMATIONS'
  | 'RESET_TIMERS'
  | 'NOTIFY_FALSE_ALARM'
  | 'NOTIFY_USER'
  | 'FLAG_OPERATOR_QUEUE'
  | 'PING_CANCEL_ALL_CHANNELS'
  | 'NOTIFY_CONFIRMERS_HOLD'
  | 'DELIVER_PRIVATE'
  | 'DELIVER_PUBLIC'
  | 'ALERT_ALL_CHANNELS';

export type Event =
  | { readonly type: 'CHECK_IN'; readonly at: number; readonly passive?: boolean }
  | { readonly type: 'MISSED_CHECK_IN'; readonly at: number }
  | { readonly type: 'REACH_VERIFYING'; readonly at: number }
  | { readonly type: 'RECORD_CONFIRMATION'; readonly at: number; readonly confirmation: Confirmation }
  | { readonly type: 'WITHDRAW_CONFIRMATION'; readonly at: number; readonly contactId: string }
  | { readonly type: 'START_HOLD'; readonly at: number; readonly operatorId: string }
  | { readonly type: 'MARK_STALLED'; readonly at: number; readonly operatorId: string }
  | { readonly type: 'REOPEN_VERIFICATION'; readonly at: number; readonly operatorId: string }
  | { readonly type: 'UPLOAD_DEATH_CERTIFICATE'; readonly at: number; readonly operatorId: string }
  | { readonly type: 'TRIGGER_PRIVATE_RELEASE'; readonly at: number; readonly operatorId: string }
  | { readonly type: 'TRIGGER_PUBLIC_RELEASE'; readonly at: number; readonly operatorId: string }
  | { readonly type: 'CANCEL'; readonly at: number; readonly source: 'user' | 'operator' | 'cancel-link' }
  | { readonly type: 'RESET'; readonly at: number }
  | { readonly type: 'SET_DEPENDENCY_HEALTH'; readonly at: number; readonly ok: boolean }
  | { readonly type: 'ADMIN_FREEZE'; readonly at: number; readonly adminId: string }
  | { readonly type: 'ADMIN_UNFREEZE'; readonly at: number; readonly adminId: string };

export interface TransitionOk {
  readonly ok: true;
  readonly machine: MachineContext;
  readonly effects: readonly Effect[];
  readonly log: AuditEntryInput;
}
export interface TransitionRejected {
  readonly ok: false;
  readonly reason: string;
  readonly machine: MachineContext;
}
export type TransitionResult = TransitionOk | TransitionRejected;

export interface InitialMachineOptions {
  readonly now: number;
  readonly evidenceMode?: EvidenceMode;
  readonly publicReleaseEnabled?: boolean;
}

export function initialMachine(options: InitialMachineOptions): MachineContext {
  return {
    state: 'ACTIVE',
    evidenceMode: options.evidenceMode ?? 'lenient',
    publicReleaseEnabled: options.publicReleaseEnabled ?? false,
    lastLivenessAt: options.now,
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
}

// --- internal helpers -------------------------------------------------------

function reject(machine: MachineContext, reason: string): TransitionRejected {
  return { ok: false, reason, machine };
}

function accept(
  machine: MachineContext,
  effects: readonly Effect[],
  log: AuditEntryInput,
): TransitionOk {
  return { ok: true, machine, effects, log };
}

function elapsedDays(from: number, to: number): number {
  return (to - from) / DAY_MS;
}

function transitionLog(
  event: string,
  from: State,
  to: State,
  at: number,
  metadata: Metadata = {},
  actor?: string,
): AuditEntryInput {
  const base = { at, kind: 'TRANSITION' as const, event, from, to, metadata };
  return actor === undefined ? base : { ...base, actor };
}

function contextLog(
  event: string,
  state: State,
  at: number,
  metadata: Metadata = {},
  actor?: string,
): AuditEntryInput {
  const base = { at, kind: 'CONTEXT' as const, event, from: state, to: state, metadata };
  return actor === undefined ? base : { ...base, actor };
}

/** Enter CANCELLED: wipe confirmations, reset every timer, notify contacts. */
function toCancelled(machine: MachineContext, at: number, source: string): TransitionOk {
  const next: MachineContext = {
    ...machine,
    state: 'CANCELLED',
    lastLivenessAt: at,
    nudgeStartedAt: null,
    verifyingStartedAt: null,
    holdStartedAt: null,
    privateReleasedAt: null,
    publicReleasedAt: null,
    confirmations: [],
    deathCertificateUploaded: false,
  };
  return accept(
    next,
    ['WIPE_CONFIRMATIONS', 'RESET_TIMERS', 'NOTIFY_FALSE_ALARM'],
    transitionLog('CANCEL', machine.state, 'CANCELLED', at, { source }),
  );
}

/** Return to ACTIVE from a liveness signal, wiping any verification context. */
function toActiveFromLiveness(
  machine: MachineContext,
  at: number,
  notify: boolean,
): TransitionOk {
  const next: MachineContext = {
    ...machine,
    state: 'ACTIVE',
    lastLivenessAt: at,
    nudgeStartedAt: null,
    verifyingStartedAt: null,
    holdStartedAt: null,
    confirmations: [],
    deathCertificateUploaded: false,
  };
  const effects: Effect[] = notify ? ['WIPE_CONFIRMATIONS', 'NOTIFY_FALSE_ALARM'] : [];
  return accept(
    next,
    effects,
    transitionLog('CHECK_IN', machine.state, 'ACTIVE', at, {}),
  );
}

// --- the guarded transition -------------------------------------------------

export function transition(machine: MachineContext, event: Event): TransitionResult {
  // Invariant 1: CANCEL is reachable from EVERY state, unconditionally. It is
  // handled before any other guard — no freeze, timer, or state can block it.
  if (event.type === 'CANCEL') {
    return toCancelled(machine, event.at, event.source);
  }

  // A user liveness signal is instant and total from any state (veto path 1).
  if (event.type === 'CHECK_IN') {
    switch (machine.state) {
      case 'ACTIVE':
        return accept(
          { ...machine, lastLivenessAt: event.at },
          [],
          transitionLog('CHECK_IN', 'ACTIVE', 'ACTIVE', event.at, { passive: event.passive ?? false }),
        );
      case 'NUDGE':
        // No third party contacted yet, so no false-alarm notice needed.
        return toActiveFromLiveness(machine, event.at, false);
      case 'VERIFYING':
      case 'STALLED':
        // Third parties may have been engaged; notify the false alarm.
        return toActiveFromLiveness(machine, event.at, true);
      case 'HOLD':
      case 'PRIVATE_RELEASE':
      case 'PUBLIC_RELEASE':
        // The one-tap "I'm alive — stop everything": a full cancel.
        return toCancelled(machine, event.at, event.passive ? 'passive-liveness' : 'user-liveness');
      case 'CANCELLED':
        return accept(
          { ...machine, state: 'ACTIVE', lastLivenessAt: event.at },
          [],
          transitionLog('CHECK_IN', 'CANCELLED', 'ACTIVE', event.at, {}),
        );
      default:
        return reject(machine, `CHECK_IN not handled from ${machine.state}`);
    }
  }

  // RESET: the deterministic return from CANCELLED to ACTIVE (§CANCELLED).
  if (event.type === 'RESET') {
    if (machine.state !== 'CANCELLED') {
      return reject(machine, 'RESET is only valid from CANCELLED');
    }
    return accept(
      { ...machine, state: 'ACTIVE', lastLivenessAt: event.at },
      [],
      transitionLog('RESET', 'CANCELLED', 'ACTIVE', event.at, {}),
    );
  }

  // Context-only events that never change the state value but must be audited.
  if (event.type === 'SET_DEPENDENCY_HEALTH') {
    return accept(
      { ...machine, dependencyHealthOk: event.ok },
      [],
      contextLog('SET_DEPENDENCY_HEALTH', machine.state, event.at, { ok: event.ok }),
    );
  }
  if (event.type === 'ADMIN_FREEZE') {
    return accept(
      { ...machine, adminFrozen: true },
      [],
      contextLog('ADMIN_FREEZE', machine.state, event.at, {}, event.adminId),
    );
  }
  if (event.type === 'ADMIN_UNFREEZE') {
    return accept(
      { ...machine, adminFrozen: false },
      [],
      contextLog('ADMIN_UNFREEZE', machine.state, event.at, {}, event.adminId),
    );
  }

  if (event.type === 'MISSED_CHECK_IN') {
    if (machine.state !== 'ACTIVE') {
      return reject(machine, `MISSED_CHECK_IN only valid from ACTIVE, not ${machine.state}`);
    }
    if (elapsedDays(machine.lastLivenessAt, event.at) < CHECK_IN_PERIOD_DAYS) {
      return reject(machine, 'check-in period has not elapsed');
    }
    return accept(
      { ...machine, state: 'NUDGE', nudgeStartedAt: event.at },
      ['NOTIFY_USER'],
      transitionLog('MISSED_CHECK_IN', 'ACTIVE', 'NUDGE', event.at, {}),
    );
  }

  if (event.type === 'REACH_VERIFYING') {
    if (machine.state !== 'NUDGE') {
      return reject(machine, `REACH_VERIFYING only valid from NUDGE, not ${machine.state}`);
    }
    // Invariant 2: no third party contacted before day 30.
    if (elapsedDays(machine.lastLivenessAt, event.at) < VERIFYING_THRESHOLD_DAYS) {
      return reject(machine, 'day-30 threshold not reached; no third party may be contacted yet');
    }
    // Veto path 3: never start reaching out on a broken notification stack.
    if (!machine.dependencyHealthOk) {
      return reject(machine, 'a critical dependency is unhealthy; cannot enter VERIFYING');
    }
    if (machine.adminFrozen) {
      return reject(machine, 'account is frozen by admin');
    }
    return accept(
      { ...machine, state: 'VERIFYING', verifyingStartedAt: event.at },
      ['FLAG_OPERATOR_QUEUE'],
      transitionLog('REACH_VERIFYING', 'NUDGE', 'VERIFYING', event.at, {
        elapsedDays: Math.floor(elapsedDays(machine.lastLivenessAt, event.at)),
      }),
    );
  }

  if (event.type === 'RECORD_CONFIRMATION') {
    if (machine.state !== 'VERIFYING') {
      return reject(machine, `confirmations are only recorded in VERIFYING, not ${machine.state}`);
    }
    if (machine.adminFrozen) {
      return reject(machine, 'account is frozen by admin');
    }
    const confirmations = [...machine.confirmations, event.confirmation];
    return accept(
      { ...machine, confirmations },
      [],
      contextLog('RECORD_CONFIRMATION', 'VERIFYING', event.at, {
        contactId: event.confirmation.contactId,
        group: event.confirmation.group,
      }, event.confirmation.recordingOperatorId),
    );
  }

  if (event.type === 'WITHDRAW_CONFIRMATION') {
    if (machine.state !== 'VERIFYING' && machine.state !== 'HOLD') {
      return reject(machine, `withdrawal only valid in VERIFYING or HOLD, not ${machine.state}`);
    }
    const exists = machine.confirmations.some((c) => c.contactId === event.contactId);
    if (!exists) {
      return reject(machine, `no confirmation from contact ${event.contactId}`);
    }
    const confirmations = machine.confirmations.filter((c) => c.contactId !== event.contactId);

    if (machine.state === 'HOLD') {
      const quorum = computeQuorum(confirmations);
      if (!quorum.met) {
        // Veto path 2: dropping below quorum reopens VERIFYING.
        return accept(
          { ...machine, state: 'VERIFYING', confirmations, holdStartedAt: null },
          [],
          transitionLog('WITHDRAW_CONFIRMATION', 'HOLD', 'VERIFYING', event.at, {
            contactId: event.contactId,
            distinctGroups: quorum.distinctGroups,
          }),
        );
      }
      return accept(
        { ...machine, confirmations },
        [],
        contextLog('WITHDRAW_CONFIRMATION', 'HOLD', event.at, {
          contactId: event.contactId,
          distinctGroups: quorum.distinctGroups,
        }),
      );
    }

    return accept(
      { ...machine, confirmations },
      [],
      contextLog('WITHDRAW_CONFIRMATION', 'VERIFYING', event.at, { contactId: event.contactId }),
    );
  }

  if (event.type === 'START_HOLD') {
    if (machine.state !== 'VERIFYING') {
      // In particular, START_HOLD is never reachable from STALLED (invariant 5).
      return reject(machine, `START_HOLD only valid from VERIFYING, not ${machine.state}`);
    }
    if (machine.adminFrozen) {
      return reject(machine, 'account is frozen by admin');
    }
    if (!machine.dependencyHealthOk) {
      return reject(machine, 'a critical dependency is unhealthy; cannot start HOLD');
    }
    // Invariant 4: quorum requires ≥3 confirmations from ≥3 distinct groups.
    const quorum = computeQuorum(machine.confirmations);
    if (!quorum.met) {
      return reject(
        machine,
        `quorum not met: ${quorum.distinctGroups} distinct group(s), need 3 from 3 distinct groups`,
      );
    }
    return accept(
      { ...machine, state: 'HOLD', holdStartedAt: event.at },
      ['PING_CANCEL_ALL_CHANNELS', 'NOTIFY_CONFIRMERS_HOLD'],
      transitionLog('START_HOLD', 'VERIFYING', 'HOLD', event.at, {
        distinctGroups: quorum.distinctGroups,
      }, event.operatorId),
    );
  }

  if (event.type === 'MARK_STALLED') {
    if (machine.state !== 'VERIFYING') {
      return reject(machine, `MARK_STALLED only valid from VERIFYING, not ${machine.state}`);
    }
    return accept(
      { ...machine, state: 'STALLED' },
      ['ALERT_ALL_CHANNELS'],
      transitionLog('MARK_STALLED', 'VERIFYING', 'STALLED', event.at, {}, event.operatorId),
    );
  }

  if (event.type === 'REOPEN_VERIFICATION') {
    if (machine.state !== 'STALLED') {
      return reject(machine, `REOPEN_VERIFICATION only valid from STALLED, not ${machine.state}`);
    }
    // Invariant 5: a deliberate manual review moves STALLED to VERIFYING —
    // never toward release.
    return accept(
      { ...machine, state: 'VERIFYING', verifyingStartedAt: event.at },
      [],
      transitionLog('REOPEN_VERIFICATION', 'STALLED', 'VERIFYING', event.at, {}, event.operatorId),
    );
  }

  if (event.type === 'UPLOAD_DEATH_CERTIFICATE') {
    if (machine.state !== 'VERIFYING' && machine.state !== 'HOLD') {
      return reject(machine, `certificate upload only valid in VERIFYING or HOLD, not ${machine.state}`);
    }
    return accept(
      { ...machine, deathCertificateUploaded: true },
      [],
      contextLog('UPLOAD_DEATH_CERTIFICATE', machine.state, event.at, {}, event.operatorId),
    );
  }

  if (event.type === 'TRIGGER_PRIVATE_RELEASE') {
    if (machine.state !== 'HOLD') {
      return reject(machine, `private release only valid from HOLD, not ${machine.state}`);
    }
    if (machine.adminFrozen) {
      return reject(machine, 'account is frozen by admin');
    }
    if (machine.holdStartedAt === null) {
      return reject(machine, 'HOLD has no start time');
    }
    // Invariant 3: the full HOLD window must have elapsed. Deterministic code —
    // no operator may skip or shorten it.
    const windowDays = holdWindowDays(machine.evidenceMode);
    if (elapsedDays(machine.holdStartedAt, event.at) < windowDays) {
      return reject(machine, `HOLD window (${windowDays}d) has not fully elapsed`);
    }
    // Strict mode: release stays blocked until a certificate is uploaded.
    if (machine.evidenceMode === 'strict' && !machine.deathCertificateUploaded) {
      return reject(machine, 'strict mode requires a death certificate before release');
    }
    // Defensive: quorum must still hold (a withdrawal would have reopened VERIFYING).
    if (!computeQuorum(machine.confirmations).met) {
      return reject(machine, 'quorum no longer met');
    }
    return accept(
      { ...machine, state: 'PRIVATE_RELEASE', privateReleasedAt: event.at },
      ['DELIVER_PRIVATE'],
      transitionLog('TRIGGER_PRIVATE_RELEASE', 'HOLD', 'PRIVATE_RELEASE', event.at, {
        evidenceMode: machine.evidenceMode,
      }, event.operatorId),
    );
  }

  if (event.type === 'TRIGGER_PUBLIC_RELEASE') {
    if (machine.state !== 'PRIVATE_RELEASE') {
      return reject(machine, `public release only valid from PRIVATE_RELEASE, not ${machine.state}`);
    }
    if (!machine.publicReleaseEnabled) {
      return reject(machine, 'public release was not enabled by the user');
    }
    if (machine.adminFrozen) {
      return reject(machine, 'account is frozen by admin');
    }
    if (machine.privateReleasedAt === null) {
      return reject(machine, 'private release has no timestamp');
    }
    // The 14-day gap is a final chance to catch a wrong release (§PUBLIC_RELEASE).
    if (elapsedDays(machine.privateReleasedAt, event.at) < PUBLIC_RELEASE_DELAY_DAYS) {
      return reject(machine, `public-release delay (${PUBLIC_RELEASE_DELAY_DAYS}d) has not elapsed`);
    }
    return accept(
      { ...machine, state: 'PUBLIC_RELEASE', publicReleasedAt: event.at },
      ['DELIVER_PUBLIC'],
      transitionLog('TRIGGER_PUBLIC_RELEASE', 'PRIVATE_RELEASE', 'PUBLIC_RELEASE', event.at, {}, event.operatorId),
    );
  }

  // Exhaustiveness: every event type is handled above.
  const _never: never = event;
  return reject(machine, `unhandled event ${(_never as Event).type}`);
}
