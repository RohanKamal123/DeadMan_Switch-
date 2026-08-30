// Weekly system health check (PRODUCT_SPEC.md §6; DECISIONS.md 3.2). Pings
// email / SMS / storage; a failure blocks entry to VERIFYING (veto path 3) and
// alerts the operator team. A prober that throws counts as a failure — fail
// safe, toward delay.

import { runHealthCheck, applyHealthToMachine, healthAlerts } from '../../src/health/health';
import { Machine } from '../../src/domain/machine';
import { T0, daysAfter } from '../support/factory';

const ALL_OK = {
  email: () => true,
  sms: () => true,
  storage: () => true,
};

describe('runHealthCheck', () => {
  it('reports allOk when every dependency passes', () => {
    const r = runHealthCheck(ALL_OK, T0);
    expect(r.allOk).toBe(true);
    expect(r.failed).toHaveLength(0);
  });

  it('reports the failing dependency', () => {
    const r = runHealthCheck({ ...ALL_OK, sms: () => false }, T0);
    expect(r.allOk).toBe(false);
    expect(r.failed).toEqual(['sms']);
  });

  it('treats a throwing prober as a failure (fail-safe)', () => {
    const r = runHealthCheck(
      {
        ...ALL_OK,
        storage: () => {
          throw new Error('bucket unreachable');
        },
      },
      T0,
    );
    expect(r.allOk).toBe(false);
    expect(r.failed).toContain('storage');
  });

  it('produces operator alerts naming the failed dependencies only', () => {
    const r = runHealthCheck({ ...ALL_OK, email: () => false }, T0);
    const alerts = healthAlerts(r);
    expect(alerts.join(' ')).toMatch(/email/);
    expect(alerts.join(' ')).not.toMatch(/sms|storage/);
  });
});

describe('applyHealthToMachine (veto path 3)', () => {
  it('an unhealthy report blocks entry to VERIFYING', () => {
    const m = new Machine({ now: T0 });
    m.apply({ type: 'MISSED_CHECK_IN', at: daysAfter(T0, 7) });
    applyHealthToMachine(m, runHealthCheck({ ...ALL_OK, storage: () => false }, daysAfter(T0, 8)), daysAfter(T0, 8));
    expect(m.context.dependencyHealthOk).toBe(false);
    const blocked = m.apply({ type: 'REACH_VERIFYING', at: daysAfter(T0, 30) });
    expect(blocked.ok).toBe(false);
  });

  it('a healthy report clears the gate so VERIFYING can be entered', () => {
    const m = new Machine({ now: T0 });
    m.apply({ type: 'MISSED_CHECK_IN', at: daysAfter(T0, 7) });
    applyHealthToMachine(m, runHealthCheck({ ...ALL_OK, storage: () => false }, daysAfter(T0, 8)), daysAfter(T0, 8));
    applyHealthToMachine(m, runHealthCheck(ALL_OK, daysAfter(T0, 29)), daysAfter(T0, 29));
    expect(m.context.dependencyHealthOk).toBe(true);
    expect(m.apply({ type: 'REACH_VERIFYING', at: daysAfter(T0, 30) }).ok).toBe(true);
  });
});
