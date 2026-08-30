// Phase G — cancel-secret rotation (DECISIONS_PHASE_F_G.md G4). A token issued
// under a previous secret must still cancel after the secret rotates, so a
// living user's link never breaks (invariant 1 survives rotation).

import type { AuditSink } from '../../src/domain/audit';
import { Machine } from '../../src/domain/machine';
import { issueCancelToken } from '../../src/cancel';
import {
  HashChainedAuditStore,
  InMemoryAppendOnlySink,
  InMemoryKeyValueStore,
  MachineRepository,
} from '../../src/persistence';
import { CancelService } from '../../src/app';
import { T0, daysAfter, machineIn } from '../support/factory';

function makeService(secret: string | readonly string[]): { service: CancelService; machines: MachineRepository } {
  const machines = new MachineRepository(new InMemoryKeyValueStore());
  const service = new CancelService({
    machines,
    auditFor: () => new HashChainedAuditStore(new InMemoryAppendOnlySink()) as AuditSink,
    secret,
  });
  machines.save('a', Machine.restore(machineIn('HOLD')));
  return { service, machines };
}

describe('CancelService secret rotation', () => {
  it('accepts a token signed with a PREVIOUS secret after rotation', () => {
    // A link was mailed under the old secret.
    const oldToken = issueCancelToken('a', T0, 'old-secret');
    // The service now runs with [current, previous].
    const { service, machines } = makeService(['new-secret', 'old-secret']);
    const res = service.redeem(oldToken, daysAfter(T0, 40));
    expect(res.ok).toBe(true);
    expect(machines.getContext('a')!.state).toBe('CANCELLED');
  });

  it('still rejects a token signed with a secret not in the set', () => {
    const foreign = issueCancelToken('a', T0, 'never-used');
    const { service } = makeService(['new-secret', 'old-secret']);
    expect(service.redeem(foreign, daysAfter(T0, 40)).ok).toBe(false);
  });
});
