// Phase F — the liveness (check-in) application service
// (DECISIONS_PHASE_F_G.md F0, F2).
//
// A user's check-in is veto path 1 (PRODUCT_SPEC.md §5): instant and total from
// any state. The user app can therefore only ever move the machine TOWARD
// ACTIVE (a reset) or, from a pending release, cancel it — it has no path that
// advances toward release (F2). This service is the only tier that mutates on
// that path: it loads the machine WITH its durable audit sink, applies CHECK_IN
// through the guarded transition, and persists. These tests pin that behaviour.

import type { AuditSink } from '../../src/domain/audit';
import { Machine } from '../../src/domain/machine';
import {
  HashChainedAuditStore,
  InMemoryAppendOnlySink,
  InMemoryKeyValueStore,
  MachineRepository,
} from '../../src/persistence';
import { LivenessService } from '../../src/app';
import type { AuditSinkFactory } from '../../src/runtime';
import { T0, daysAfter, machineIn } from '../support/factory';

function harness() {
  const machines = new MachineRepository(new InMemoryKeyValueStore());
  const stores = new Map<string, HashChainedAuditStore>();
  const storeFor = (id: string): HashChainedAuditStore => {
    let s = stores.get(id);
    if (s === undefined) {
      s = new HashChainedAuditStore(new InMemoryAppendOnlySink());
      stores.set(id, s);
    }
    return s;
  };
  const auditFor: AuditSinkFactory = (id) => storeFor(id) as AuditSink;
  const service = new LivenessService({ machines, auditFor });
  const seed = (id: string, ctx: ReturnType<typeof machineIn>): void => {
    machines.save(id, Machine.restore(ctx));
  };
  return { machines, service, storeFor, seed };
}

describe('LivenessService.checkIn', () => {
  it('records a check-in from ACTIVE and keeps the account ACTIVE', () => {
    const h = harness();
    h.seed('a', machineIn('ACTIVE'));
    const outcome = h.service.checkIn('a', daysAfter(T0, 3));
    expect(outcome).toEqual({ ok: true, state: 'ACTIVE' });
    expect(h.machines.getContext('a')!.lastLivenessAt).toBe(daysAfter(T0, 3));
  });

  it('resets NUDGE back to ACTIVE (the user, and only the user, was contacted)', () => {
    const h = harness();
    h.seed('a', machineIn('NUDGE'));
    const outcome = h.service.checkIn('a', daysAfter(T0, 10));
    expect(outcome).toEqual({ ok: true, state: 'ACTIVE' });
  });

  it('a check-in during VERIFYING returns to ACTIVE (veto path 1)', () => {
    const h = harness();
    h.seed('a', machineIn('VERIFYING'));
    const outcome = h.service.checkIn('a', daysAfter(T0, 31));
    expect(outcome).toEqual({ ok: true, state: 'ACTIVE' });
  });

  it('a check-in during HOLD is the one-tap "I am alive" — a full cancel', () => {
    const h = harness();
    h.seed('a', machineIn('HOLD'));
    const outcome = h.service.checkIn('a', daysAfter(T0, 40));
    expect(outcome).toEqual({ ok: true, state: 'CANCELLED' });
  });

  it('the check-in is written to the durable, verifiable audit trail (invariant 7)', () => {
    const h = harness();
    h.seed('a', machineIn('ACTIVE'));
    h.service.checkIn('a', daysAfter(T0, 3));
    const store = h.storeFor('a');
    expect(store.verify().ok).toBe(true);
    expect(store.all().map((e) => e.event)).toContain('CHECK_IN');
  });

  it('passes a passive signal through (it only ever resets/cancels, never advances)', () => {
    const h = harness();
    h.seed('a', machineIn('HOLD'));
    const outcome = h.service.checkIn('a', daysAfter(T0, 40), { passive: true });
    // A passive signal never advances; from HOLD it cancels — the safe direction.
    expect(outcome).toEqual({ ok: true, state: 'CANCELLED' });
  });

  it('an unknown account fails safe without fabricating state', () => {
    const h = harness();
    const outcome = h.service.checkIn('ghost', daysAfter(T0, 1));
    expect(outcome.ok).toBe(false);
    expect(h.machines.getContext('ghost')).toBeUndefined();
  });
});
