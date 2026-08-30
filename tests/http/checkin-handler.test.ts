// Phase F — the user-app check-in endpoint (DECISIONS_PHASE_F_G.md F2, F3).
//
// The one user-app mutation in this slice. It sits behind the auth seam (only a
// 'user' principal, and only for their OWN account), and it maps to the liveness
// reset — the app can never advance the machine toward release (F2). A pure
// handler over a parsed request, tested without a socket.

import type { AuditSink } from '../../src/domain/audit';
import { Machine } from '../../src/domain/machine';
import {
  HashChainedAuditStore,
  InMemoryAppendOnlySink,
  InMemoryKeyValueStore,
  MachineRepository,
} from '../../src/persistence';
import { LivenessService } from '../../src/app';
import { DevAuthenticator, handleCheckIn, type HttpRequest } from '../../src/http';
import { T0, daysAfter, machineIn } from '../support/factory';

function harness() {
  const machines = new MachineRepository(new InMemoryKeyValueStore());
  const auditFor = () => new HashChainedAuditStore(new InMemoryAppendOnlySink()) as AuditSink;
  const liveness = new LivenessService({ machines, auditFor });
  machines.save('a1', Machine.restore(machineIn('HOLD')));
  machines.save('a2', Machine.restore(machineIn('NUDGE')));
  const authenticator = new DevAuthenticator({
    'tok-a1': { kind: 'user', id: 'u1', accountId: 'a1' },
    'tok-a2': { kind: 'user', id: 'u2', accountId: 'a2' },
    'tok-operator': { kind: 'operator', id: 'op1' },
  });
  const deps = { authenticator, liveness, now: () => daysAfter(T0, 40) };
  return { machines, deps };
}

function post(token: string | undefined, body: unknown): HttpRequest {
  return {
    method: 'POST',
    path: '/check-in',
    query: {},
    headers: token === undefined ? {} : { authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
    contentType: 'application/json',
  };
}

describe('handleCheckIn', () => {
  it('records the authenticated user’s check-in on their own account', () => {
    const { deps, machines } = harness();
    const res = handleCheckIn(post('tok-a1', {}), deps);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ state: 'CANCELLED' }); // HOLD + check-in = cancel
    expect(machines.getContext('a1')!.state).toBe('CANCELLED');
  });

  it('rejects an unauthenticated request with 401 and changes nothing', () => {
    const { deps, machines } = harness();
    const res = handleCheckIn(post(undefined, {}), deps);
    expect(res.status).toBe(401);
    expect(machines.getContext('a1')!.state).toBe('HOLD');
  });

  it('rejects a non-user principal with 403 (only the user app checks in)', () => {
    const { deps } = harness();
    const res = handleCheckIn(post('tok-operator', { accountId: 'a1' }), deps);
    expect(res.status).toBe(403);
  });

  it('forbids checking in an account the user does not own (403), no cross-account reset', () => {
    const { deps, machines } = harness();
    const res = handleCheckIn(post('tok-a2', { accountId: 'a1' }), deps);
    expect(res.status).toBe(403);
    expect(machines.getContext('a1')!.state).toBe('HOLD');
  });

  it('defaults the account to the principal’s own when the body omits it', () => {
    const { deps, machines } = harness();
    const res = handleCheckIn(post('tok-a2', {}), deps);
    expect(res.status).toBe(200);
    expect(machines.getContext('a2')!.state).toBe('ACTIVE');
  });

  it('rejects a non-POST method', () => {
    const { deps } = harness();
    const res = handleCheckIn({ ...post('tok-a1', {}), method: 'GET' }, deps);
    expect(res.status).toBe(405);
  });
});
