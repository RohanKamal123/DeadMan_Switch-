// Weekly automated system health check (PRODUCT_SPEC.md §6; DECISIONS.md 3.2).
// Pings email / SMS / storage — in production by sending a real test email/SMS
// to a company-owned address/number and verifying stored payloads decrypt. A
// failure blocks entry to VERIFYING (veto path 3) and alerts the team. There is
// no automated test call — V1 has no telephony dependency.
//
// Probers are injected so the real deliverability checks live at the edge; a
// prober that throws is treated as a failure (fail safe, toward delay).

import type { Machine } from '../domain/machine';
import type { TransitionResult } from '../domain/transition';

export type Dependency = 'email' | 'sms' | 'storage';
export const DEPENDENCIES: readonly Dependency[] = ['email', 'sms', 'storage'];

export type Prober = () => boolean;

export interface DependencyProbe {
  readonly dependency: Dependency;
  readonly ok: boolean;
  readonly detail: string | null;
}

export interface HealthReport {
  readonly at: number;
  readonly probes: readonly DependencyProbe[];
  readonly allOk: boolean;
  readonly failed: readonly Dependency[];
}

export function runHealthCheck(probers: Record<Dependency, Prober>, at: number): HealthReport {
  const probes: DependencyProbe[] = DEPENDENCIES.map((dependency) => {
    try {
      const ok = probers[dependency]();
      return { dependency, ok, detail: ok ? null : 'probe returned not-ok' };
    } catch {
      return { dependency, ok: false, detail: 'probe threw' };
    }
  });
  const failed = probes.filter((p) => !p.ok).map((p) => p.dependency);
  return { at, probes, allOk: failed.length === 0, failed };
}

/** Operator-facing alerts naming only the failed dependencies (metadata-safe). */
export function healthAlerts(report: HealthReport): string[] {
  return report.failed.map((dependency) => `dependency "${dependency}" failed its health check`);
}

/**
 * Feed a report into the machine's dependency-health gate (veto path 3). When
 * unhealthy, the machine will reject entry to VERIFYING until a later healthy
 * report clears it.
 */
export function applyHealthToMachine(machine: Machine, report: HealthReport, at: number): TransitionResult {
  return machine.apply({ type: 'SET_DEPENDENCY_HEALTH', at, ok: report.allOk });
}
