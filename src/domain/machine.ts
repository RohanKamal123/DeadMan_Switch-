// A thin stateful runner around the pure `transition` function. It holds the
// current context and the audit log, and it is the ONLY place that advances
// state: on an accepted transition it swaps in the new context and appends the
// audit entry (invariant 7). A rejected transition changes nothing.

import { AuditLog, type AuditSink } from './audit';
import {
  initialMachine,
  transition,
  type Event,
  type MachineContext,
  type TransitionResult,
} from './transition';
import type { EvidenceMode } from './states';

export interface MachineOptions {
  readonly now?: number;
  readonly evidenceMode?: EvidenceMode;
  readonly publicReleaseEnabled?: boolean;
  /**
   * The audit destination. Defaults to a fresh in-memory `AuditLog`; Phase D
   * injects the durable, tamper-evident store so every accepted transition is
   * persisted immutably (invariant 7). The machine never bypasses it.
   */
  readonly audit?: AuditSink;
}

export class Machine {
  context: MachineContext;
  readonly audit: AuditSink;

  constructor(options: MachineOptions = {}) {
    this.audit = options.audit ?? new AuditLog();
    this.context = initialMachine({
      now: options.now ?? Date.now(),
      ...(options.evidenceMode !== undefined ? { evidenceMode: options.evidenceMode } : {}),
      ...(options.publicReleaseEnabled !== undefined
        ? { publicReleaseEnabled: options.publicReleaseEnabled }
        : {}),
    });
  }

  /**
   * Rebuild a machine resting in a persisted context (Phase D: state survives a
   * restart). The snapshot is a value previously produced by `transition` and
   * stored by a repository — restore never fabricates a state, it only reloads
   * one, so the "no ad-hoc status writes" rule still holds: further changes go
   * back through `apply` → `transition`.
   */
  static restore(context: MachineContext, options: { readonly audit?: AuditSink } = {}): Machine {
    const machine = new Machine({ audit: options.audit });
    machine.context = context;
    return machine;
  }

  apply(event: Event): TransitionResult {
    const result = transition(this.context, event);
    if (result.ok) {
      this.context = result.machine;
      this.audit.append(result.log);
    }
    return result;
  }

  get state() {
    return this.context.state;
  }
}
