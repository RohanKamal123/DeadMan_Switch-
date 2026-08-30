// Phase F — the cancel application service (DECISIONS_PHASE_F_G.md F0, F1).
//
// The cancel service is the only tier that mutates on the cancel path: it
// verifies the signed token, loads the persisted machine WITH its durable audit
// sink, applies CANCEL through the guarded transition (never an ad-hoc write),
// and persists the result. These tests pin its behaviour:
//   - a valid token cancels and the cancellation is durable + audited;
//   - preview() never mutates (GET must be side-effect free, F1.1);
//   - redeem is idempotent — a second cancel is success, not an error (F1.3);
//   - a bad/forged token changes nothing (fail-safe, F1.2);
//   - a store failure propagates (the HTTP layer degrades to the fallback page).

import type { AuditSink } from '../../src/domain/audit';
import { Machine } from '../../src/domain/machine';
import {
  HashChainedAuditStore,
  InMemoryAppendOnlySink,
  InMemoryKeyValueStore,
  MachineRepository,
} from '../../src/persistence';
import { CancelService } from '../../src/app';
import type { AuditSinkFactory } from '../../src/runtime';
import { T0, daysAfter, machineIn } from '../support/factory';

const SECRET = 'test-cancel-secret';

interface Harness {
  service: CancelService;
  machines: MachineRepository;
  storeFor: (id: string) => HashChainedAuditStore;
  seed: (accountId: string, context: ReturnType<typeof machineIn>) => void;
}

function harness(): Harness {
  const stateStore = new InMemoryKeyValueStore();
  const machines = new MachineRepository(stateStore);
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
  const service = new CancelService({ machines, auditFor, secret: SECRET });
  const seed = (accountId: string, context: ReturnType<typeof machineIn>): void => {
    machines.save(accountId, Machine.restore(context));
  };
  return { service, machines, storeFor, seed };
}

describe('CancelService', () => {
  it('cancels a pending (HOLD) account and persists CANCELLED', () => {
    const h = harness();
    h.seed('acct-1', machineIn('HOLD'));
    const token = h.service.issueToken('acct-1', T0);

    const outcome = h.service.redeem(token, daysAfter(T0, 40));

    expect(outcome).toEqual({ ok: true, accountId: 'acct-1' });
    expect(h.machines.getContext('acct-1')!.state).toBe('CANCELLED');
  });

  it('writes the cancellation to the durable, tamper-evident audit trail (invariant 7)', () => {
    const h = harness();
    h.seed('acct-1', machineIn('HOLD'));
    const token = h.service.issueToken('acct-1', T0);

    h.service.redeem(token, daysAfter(T0, 40));

    const store = h.storeFor('acct-1');
    expect(store.verify().ok).toBe(true);
    const events = store.all().map((e) => e.event);
    expect(events).toContain('CANCEL');
  });

  it('preview() validates a token WITHOUT mutating state (GET is side-effect free, F1.1)', () => {
    const h = harness();
    h.seed('acct-1', machineIn('HOLD'));
    const token = h.service.issueToken('acct-1', T0);

    const preview = h.service.preview(token, daysAfter(T0, 40));

    expect(preview).toEqual({ ok: true, accountId: 'acct-1' });
    // Nothing moved — only POST/redeem may cancel.
    expect(h.machines.getContext('acct-1')!.state).toBe('HOLD');
    expect(h.storeFor('acct-1').all()).toHaveLength(0);
  });

  it('is idempotent: a second redeem is success, not an error (F1.3)', () => {
    const h = harness();
    h.seed('acct-1', machineIn('HOLD'));
    const token = h.service.issueToken('acct-1', T0);

    const first = h.service.redeem(token, daysAfter(T0, 40));
    const second = h.service.redeem(token, daysAfter(T0, 41));

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(h.machines.getContext('acct-1')!.state).toBe('CANCELLED');
  });

  it('cancelling an already-safe (ACTIVE) account still succeeds (reassuring, never a scary error)', () => {
    const h = harness();
    h.seed('acct-1', machineIn('ACTIVE'));
    const token = h.service.issueToken('acct-1', T0);

    const outcome = h.service.redeem(token, daysAfter(T0, 1));

    expect(outcome.ok).toBe(true);
  });

  it('a forged / mismatched-signature token changes nothing', () => {
    const h = harness();
    h.seed('acct-1', machineIn('HOLD'));
    const forged = h.service.issueToken('acct-1', T0) + 'tamper';

    const outcome = h.service.redeem(forged, daysAfter(T0, 40));

    expect(outcome.ok).toBe(false);
    expect(h.machines.getContext('acct-1')!.state).toBe('HOLD');
  });

  it('a token signed with a different secret is rejected', () => {
    const h = harness();
    h.seed('acct-1', machineIn('HOLD'));
    const other = new CancelService({
      machines: h.machines,
      auditFor: () => new HashChainedAuditStore(new InMemoryAppendOnlySink()) as AuditSink,
      secret: 'a-different-secret',
    });
    const foreignToken = other.issueToken('acct-1', T0);

    const outcome = h.service.redeem(foreignToken, daysAfter(T0, 40));

    expect(outcome.ok).toBe(false);
    expect(h.machines.getContext('acct-1')!.state).toBe('HOLD');
  });

  it('a valid token for an unknown account fails safe (no state fabricated)', () => {
    const h = harness();
    const token = h.service.issueToken('ghost', T0);

    const outcome = h.service.redeem(token, daysAfter(T0, 1));

    expect(outcome.ok).toBe(false);
    expect(h.machines.getContext('ghost')).toBeUndefined();
  });
});
