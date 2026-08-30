// Phase F — the operator application service (DECISIONS_PHASE_F_G.md F2).
//
// The operator console already carries every structural guardrail (group read
// from the roster so invariant 4 can't be faked, consent/stale gates, the
// start-HOLD quorum block, metadata-only audit). This service is the tier that
// loads the machine + roster + operational case file from the Phase D
// repositories, drives the console, and persists BOTH the machine snapshot and
// the case file. It writes no state of its own — the console's actions, which go
// through the guarded transition, remain the single source of truth.

import type { AuditSink } from '../../src/domain/audit';
import type { Group } from '../../src/domain/states';
import { Machine } from '../../src/domain/machine';
import type { Contact } from '../../src/console';
import {
  CaseFileRepository,
  ContactRepository,
  HashChainedAuditStore,
  InMemoryAppendOnlySink,
  InMemoryKeyValueStore,
  MachineRepository,
} from '../../src/persistence';
import { OperatorService } from '../../src/app';
import type { AuditSinkFactory } from '../../src/runtime';
import { T0, daysAfter, machineIn } from '../support/factory';

const OP = 'op-1';

function contact(id: string, group: Group): Contact {
  return {
    id,
    name: `name-${id}`,
    group,
    roles: ['confirmer'],
    email: `${id}@example.test`,
    phone: '+100',
    consentAt: T0,
    stale: false,
  };
}

function harness() {
  const store = new InMemoryKeyValueStore();
  const machines = new MachineRepository(store);
  const contacts = new ContactRepository(store);
  const caseFiles = new CaseFileRepository(store);
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
  const service = new OperatorService({ machines, contacts, caseFiles, auditFor });

  // An account under verification with three eligible confirmers in three groups.
  machines.save('a', Machine.restore(machineIn('VERIFYING', { confirmations: [] })));
  for (const c of [contact('c1', 'family'), contact('c2', 'friend'), contact('c3', 'colleague')]) {
    contacts.save('a', c);
  }
  return { service, machines, caseFiles, storeFor };
}

describe('OperatorService — verification workflow', () => {
  it('records a confirmation; the group comes from the roster (invariant 4 cannot be faked)', () => {
    const h = harness();
    const res = h.service.recordConfirmation('a', 'c1', OP, daysAfter(T0, 31));
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.quorum.distinctGroups).toBe(1);
      expect(res.quorum.met).toBe(false);
    }
  });

  it('blocks START_HOLD until 3 confirmations from 3 distinct groups (invariant 4, 10.2)', () => {
    const h = harness();
    // One confirmation — nowhere near quorum.
    h.service.recordConfirmation('a', 'c1', OP, daysAfter(T0, 31));
    const blocked = h.service.startHold('a', OP, daysAfter(T0, 31));
    expect(blocked.ok).toBe(false);
    expect(h.machines.getContext('a')!.state).toBe('VERIFYING');

    // Three distinct groups — quorum met, HOLD may start.
    h.service.recordConfirmation('a', 'c2', OP, daysAfter(T0, 31));
    h.service.recordConfirmation('a', 'c3', OP, daysAfter(T0, 31));
    const ok = h.service.startHold('a', OP, daysAfter(T0, 31));
    expect(ok.ok).toBe(true);
    expect(h.machines.getContext('a')!.state).toBe('HOLD');
  });

  it('refuses an unknown contact (the console gate rejects before the machine)', () => {
    const h = harness();
    const res = h.service.recordConfirmation('a', 'missing', OP, daysAfter(T0, 31));
    expect(res.ok).toBe(false);
    expect(h.machines.getContext('a')!.confirmations).toHaveLength(0);
  });

  it('persists both the machine snapshot and the operational case file', () => {
    const h = harness();
    h.service.viewContact('a', 'c1', OP, daysAfter(T0, 31));
    h.service.recordContactState('a', 'c1', 'deceased', OP, daysAfter(T0, 31));
    const snap = h.caseFiles.get('a');
    expect(snap).toBeDefined();
    expect(snap!.contacts['c1']!.state).toBe('deceased');
    expect(snap!.contacts['c1']!.viewCount).toBe(1);
  });

  it('writes operator actions to the durable, verifiable audit trail (invariant 7)', () => {
    const h = harness();
    h.service.viewContact('a', 'c1', OP, daysAfter(T0, 31));
    h.service.recordConfirmation('a', 'c1', OP, daysAfter(T0, 31));
    const store = h.storeFor('a');
    expect(store.verify().ok).toBe(true);
    const events = store.all().map((e) => e.event);
    expect(events).toContain('VIEW_CONTACT');
    expect(events).toContain('RECORD_CONFIRMATION');
  });

  it('marks STALLED and reopens verification without ever advancing toward release (invariant 5)', () => {
    const h = harness();
    const stalled = h.service.markStalled('a', OP, daysAfter(T0, 31));
    expect(stalled.ok).toBe(true);
    expect(h.machines.getContext('a')!.state).toBe('STALLED');
    // A stalled account cannot start a hold — reopen only ever goes to VERIFYING.
    const reopened = h.service.reopenVerification('a', OP, daysAfter(T0, 32));
    expect(reopened.ok).toBe(true);
    expect(h.machines.getContext('a')!.state).toBe('VERIFYING');
  });

  it('a read snapshot reports state, the quorum meter, and hold readiness', () => {
    const h = harness();
    h.service.recordConfirmation('a', 'c1', OP, daysAfter(T0, 31));
    const view = h.service.snapshot('a');
    expect(view).toBeDefined();
    expect(view!.state).toBe('VERIFYING');
    expect(view!.quorum.distinctGroups).toBe(1);
    expect(view!.holdReadiness.canStart).toBe(false);
  });

  it('an unknown account fails safe', () => {
    const h = harness();
    expect(h.service.startHold('ghost', OP, T0).ok).toBe(false);
    expect(h.service.snapshot('ghost')).toBeUndefined();
  });
});
