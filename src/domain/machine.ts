// A thin stateful runner around the pure `transition` function. It holds the
// current context and the audit log, and it is the ONLY place that advances
// state: on an accepted transition it swaps in the new context and appends the
// audit entry (invariant 7). A rejected transition changes nothing.

import { AuditLog } from './audit';
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
}

export class Machine {
  context: MachineContext;
  readonly audit = new AuditLog();

  constructor(options: MachineOptions = {}) {
    this.context = initialMachine({
      now: options.now ?? Date.now(),
      ...(options.evidenceMode !== undefined ? { evidenceMode: options.evidenceMode } : {}),
      ...(options.publicReleaseEnabled !== undefined
        ? { publicReleaseEnabled: options.publicReleaseEnabled }
        : {}),
    });
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
