// Phase F — the liveness (check-in) application service
// (DECISIONS_PHASE_F_G.md F0, F2).
//
// A user's check-in is veto path 1 (PRODUCT_SPEC.md §5): instant and total from
// any state. This service loads the machine WITH its durable audit sink, applies
// CHECK_IN through the guarded `transition`, and persists — the only tier that
// mutates on the liveness path. Because the domain's CHECK_IN handler only ever
// RESETS toward ACTIVE or CANCELS a pending release, the user app has no path
// that advances the machine toward release (F2); that asymmetry is a property of
// the transition table, not a runtime check here.

import type { State } from '../domain/states';
import type { MachineRepository } from '../persistence';
import type { AuditSinkFactory } from '../runtime';

export interface LivenessServiceOptions {
  readonly machines: MachineRepository;
  /** The durable, per-account audit sink so every check-in is logged (invariant 7). */
  readonly auditFor: AuditSinkFactory;
}

export type CheckInOutcome =
  | { readonly ok: true; readonly state: State }
  | { readonly ok: false; readonly reason: string };

export class LivenessService {
  private readonly machines: MachineRepository;
  private readonly auditFor: AuditSinkFactory;

  constructor(options: LivenessServiceOptions) {
    this.machines = options.machines;
    this.auditFor = options.auditFor;
  }

  /**
   * Record a liveness signal for an account. `passive` marks an opt-in passive
   * signal (§3): it is passed through to the domain, which never lets it advance
   * — only reset or, from a pending release, cancel (the safe direction).
   */
  checkIn(accountId: string, at: number, opts: { readonly passive?: boolean } = {}): CheckInOutcome {
    const machine = this.machines.load(accountId, this.auditFor(accountId));
    if (machine === undefined) {
      return { ok: false, reason: 'account not found' };
    }
    const result = machine.apply({ type: 'CHECK_IN', at, passive: opts.passive ?? false });
    if (!result.ok) {
      return { ok: false, reason: result.reason };
    }
    this.machines.save(accountId, machine);
    return { ok: true, state: machine.state };
  }
}
