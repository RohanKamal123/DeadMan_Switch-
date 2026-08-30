// Phase F — the admin endpoints (DECISIONS_PHASE_F_G.md F2). Behind the admin
// auth seam; freeze/unfreeze/revoke attributed to the authenticated admin.

import type { AuditSink } from '../../src/domain/audit';
import { Machine } from '../../src/domain/machine';
import {
  ContactRepository,
  DeliveryRepository,
  HashChainedAuditStore,
  InMemoryAppendOnlySink,
  InMemoryKeyValueStore,
  MachineRepository,
  PayloadRepository,
  ReleasePlanRepository,
} from '../../src/persistence';
import { AdminService, ReleaseService } from '../../src/app';
import { DevAuthenticator, handleAdmin, type HttpRequest } from '../../src/http';
import { machineIn } from '../support/factory';

function harness() {
  const store = new InMemoryKeyValueStore();
  const machines = new MachineRepository(store);
  const contacts = new ContactRepository(store);
  const payloads = new PayloadRepository(store);
  const plans = new ReleasePlanRepository(store);
  const deliveries = new DeliveryRepository(store);
  const auditFor = () => new HashChainedAuditStore(new InMemoryAppendOnlySink()) as AuditSink;
  const release = new ReleaseService({ machines, contacts, payloads, plans, deliveries, auditFor });
  const admin = new AdminService({ machines, auditFor, release });
  machines.save('a', Machine.restore(machineIn('VERIFYING', { confirmations: [] })));
  const authenticator = new DevAuthenticator({
    'tok-admin': { kind: 'admin', id: 'ad1' },
    'tok-op': { kind: 'operator', id: 'op1' },
  });
  return { deps: { authenticator, admin, now: () => 0 }, machines };
}

function req(token: string | undefined, path: string, body?: unknown): HttpRequest {
  return {
    method: 'POST',
    path,
    query: {},
    headers: token === undefined ? {} : { authorization: `Bearer ${token}` },
    body: body === undefined ? '' : JSON.stringify(body),
    contentType: 'application/json',
  };
}

describe('handleAdmin', () => {
  it('403s a non-admin principal (an operator may not freeze)', () => {
    const { deps, machines } = harness();
    const res = handleAdmin(req('tok-op', '/admin/freeze', { accountId: 'a' }), deps);
    expect(res.status).toBe(403);
    expect(machines.getContext('a')!.adminFrozen).toBe(false);
  });

  it('freezes an account for an admin (200)', () => {
    const { deps, machines } = harness();
    const res = handleAdmin(req('tok-admin', '/admin/freeze', { accountId: 'a' }), deps);
    expect(res.status).toBe(200);
    expect(machines.getContext('a')!.adminFrozen).toBe(true);
  });

  it('400s when accountId is missing', () => {
    const { deps } = harness();
    expect(handleAdmin(req('tok-admin', '/admin/freeze', {}), deps).status).toBe(400);
  });

  it('404s an unknown admin route', () => {
    const { deps } = harness();
    expect(handleAdmin(req('tok-admin', '/admin/nonsense', { accountId: 'a' }), deps).status).toBe(404);
  });
});
