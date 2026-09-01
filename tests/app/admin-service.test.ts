// Phase F — the admin application service (DECISIONS_PHASE_F_G.md F2; veto path
// 4). Admin freeze/unfreeze and release-access revocation, every action
// attributed and audited (invariant 7). Freeze is fail-safe (toward delay), so
// it needs no HOLD-style window.

import type { AuditSink } from '../../src/domain/audit';
import { Machine } from '../../src/domain/machine';
import type { Contact } from '../../src/console';
import type { Payload } from '../../src/domain/payload';
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
import type { AuditSinkFactory } from '../../src/runtime';
import { T0, daysAfter, machineIn } from '../support/factory';

const ADMIN = 'admin-1';
const RELEASED_AT = daysAfter(T0, 62);

function recipient(id: string): Contact {
  return { id, name: id, group: 'other', roles: ['recipient'], email: `${id}@t.test`, phone: `+1${id}`, consentAt: T0, stale: false };
}
function payload(id: string, recipientIds: readonly string[]): Payload {
  return {
    id, kind: 'note', mimeType: 'text/plain', byteSize: 10,
    envelope: { algorithm: 'AES-256-GCM', keyId: 'k', encryptedDataKey: 'edk', iv: 'iv', ciphertext: 'ct', version: 1 },
    recipientIds, version: 1, createdAt: T0, updatedAt: T0,
  };
}

function harness() {
  const store = new InMemoryKeyValueStore();
  const machines = new MachineRepository(store);
  const contacts = new ContactRepository(store);
  const payloads = new PayloadRepository(store);
  const plans = new ReleasePlanRepository(store);
  const deliveries = new DeliveryRepository(store);
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
  const release = new ReleaseService({ machines, contacts, payloads, plans, deliveries, auditFor });
  const admin = new AdminService({ machines, auditFor, release });
  return { admin, release, machines, contacts, payloads, storeFor };
}

describe('AdminService', () => {
  it('freezes and unfreezes an account, attributing both to the admin (invariant 7)', () => {
    const h = harness();
    h.machines.save('a', Machine.restore(machineIn('VERIFYING', { confirmations: [] })));
    expect(h.admin.freeze('a', ADMIN, T0).ok).toBe(true);
    expect(h.machines.getContext('a')!.adminFrozen).toBe(true);
    expect(h.admin.unfreeze('a', ADMIN, T0 + 1).ok).toBe(true);
    expect(h.machines.getContext('a')!.adminFrozen).toBe(false);

    const events = h.storeFor('a').all();
    expect(h.storeFor('a').verify().ok).toBe(true);
    expect(events.map((e) => e.event)).toEqual(expect.arrayContaining(['ADMIN_FREEZE', 'ADMIN_UNFREEZE']));
    expect(events.find((e) => e.event === 'ADMIN_FREEZE')!.actor).toBe(ADMIN);
  });

  it('a frozen account blocks entry to VERIFYING and starting a HOLD (veto path 4)', () => {
    const h = harness();
    // Freeze while in NUDGE, then the day-30 REACH_VERIFYING must be refused.
    const ctx = machineIn('NUDGE');
    h.machines.save('a', Machine.restore(ctx));
    h.admin.freeze('a', ADMIN, daysAfter(T0, 20));
    const machine = h.machines.load('a', h.storeFor('a'))!;
    const res = machine.apply({ type: 'REACH_VERIFYING', at: daysAfter(T0, 31) });
    expect(res.ok).toBe(false);
    expect(machine.state).toBe('NUDGE');
  });

  it('revokes a recipient’s release access, denying further authentication', async () => {
    const h = harness();
    h.machines.save('a', Machine.restore(machineIn('PRIVATE_RELEASE')));
    h.contacts.save('a', recipient('r1'));
    h.payloads.save('a', payload('p1', ['r1']));
    const begun = h.release.begin('a', ['r1'], RELEASED_AT);
    if (!begun.ok) throw new Error('begin failed');
    const email = begun.messages.find((m) => m.channel === 'email');
    const sms = begun.messages.find((m) => m.channel === 'sms');
    if (email?.channel !== 'email' || sms?.channel !== 'sms') throw new Error('missing messages');

    expect(h.admin.revoke('a', 'r1', ADMIN, RELEASED_AT + 1).ok).toBe(true);
    const res = await h.release.authenticate('a', email.gatedLink, sms.code, RELEASED_AT + 2);
    expect(res.ok).toBe(false);
  });

  it('an unknown account fails safe', () => {
    const h = harness();
    expect(h.admin.freeze('ghost', ADMIN, T0).ok).toBe(false);
  });
});
