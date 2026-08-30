// Phase F — the operator-console endpoints (DECISIONS_PHASE_F_G.md F2, F3).
//
// Thin transport over OperatorService, behind the auth seam (operator principals
// only). No endpoint writes state — each maps to a console action, which goes
// through the guarded transition. A rejected action (e.g. START_HOLD before
// quorum) is a 409, never a silent success.

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
import { DevAuthenticator, handleOperator, type HttpRequest } from '../../src/http';
import { T0, daysAfter, machineIn } from '../support/factory';

function contact(id: string, group: Group): Contact {
  return { id, name: id, group, roles: ['confirmer'], email: `${id}@t.test`, phone: '+1', consentAt: T0, stale: false };
}

function harness() {
  const store = new InMemoryKeyValueStore();
  const machines = new MachineRepository(store);
  const contacts = new ContactRepository(store);
  const caseFiles = new CaseFileRepository(store);
  const auditFor = () => new HashChainedAuditStore(new InMemoryAppendOnlySink()) as AuditSink;
  const operators = new OperatorService({ machines, contacts, caseFiles, auditFor });
  machines.save('a', Machine.restore(machineIn('VERIFYING', { confirmations: [] })));
  for (const c of [contact('c1', 'family'), contact('c2', 'friend'), contact('c3', 'colleague')]) {
    contacts.save('a', c);
  }
  const authenticator = new DevAuthenticator({
    'tok-op': { kind: 'operator', id: 'op-1' },
    'tok-user': { kind: 'user', id: 'u1', accountId: 'a' },
  });
  const deps = { authenticator, operators, now: () => daysAfter(T0, 31) };
  return { machines, deps };
}

function req(token: string | undefined, method: string, path: string, body?: unknown, query: Record<string, string> = {}): HttpRequest {
  return {
    method,
    path,
    query,
    headers: token === undefined ? {} : { authorization: `Bearer ${token}` },
    body: body === undefined ? '' : JSON.stringify(body),
    contentType: 'application/json',
  };
}

describe('handleOperator — auth (F3)', () => {
  it('401 without a credential', () => {
    const { deps } = harness();
    expect(handleOperator(req(undefined, 'POST', '/operator/confirmations', { accountId: 'a', contactId: 'c1' }), deps).status).toBe(401);
  });
  it('403 for a non-operator principal (a user may not drive the console)', () => {
    const { deps, machines } = harness();
    const res = handleOperator(req('tok-user', 'POST', '/operator/confirmations', { accountId: 'a', contactId: 'c1' }), deps);
    expect(res.status).toBe(403);
    expect(machines.getContext('a')!.confirmations).toHaveLength(0);
  });
});

describe('handleOperator — verification workflow', () => {
  it('records a confirmation (200) and reports the quorum meter', () => {
    const { deps } = harness();
    const res = handleOperator(req('tok-op', 'POST', '/operator/confirmations', { accountId: 'a', contactId: 'c1' }), deps);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body).quorum.distinctGroups).toBe(1);
  });

  it('rejects START_HOLD before quorum with 409, leaving VERIFYING intact', () => {
    const { deps, machines } = harness();
    handleOperator(req('tok-op', 'POST', '/operator/confirmations', { accountId: 'a', contactId: 'c1' }), deps);
    const res = handleOperator(req('tok-op', 'POST', '/operator/hold', { accountId: 'a' }), deps);
    expect(res.status).toBe(409);
    expect(machines.getContext('a')!.state).toBe('VERIFYING');
  });

  it('starts HOLD once quorum is met (200 → HOLD)', () => {
    const { deps, machines } = harness();
    for (const contactId of ['c1', 'c2', 'c3']) {
      handleOperator(req('tok-op', 'POST', '/operator/confirmations', { accountId: 'a', contactId }), deps);
    }
    const res = handleOperator(req('tok-op', 'POST', '/operator/hold', { accountId: 'a' }), deps);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body).state).toBe('HOLD');
    expect(machines.getContext('a')!.state).toBe('HOLD');
  });

  it('reads a case snapshot on GET', () => {
    const { deps } = harness();
    const res = handleOperator(req('tok-op', 'GET', '/operator/case', undefined, { accountId: 'a' }), deps);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body).state).toBe('VERIFYING');
  });

  it('404 for an unknown account', () => {
    const { deps } = harness();
    const res = handleOperator(req('tok-op', 'POST', '/operator/hold', { accountId: 'ghost' }), deps);
    expect(res.status).toBe(404);
  });

  it('404 for an unknown operator route', () => {
    const { deps } = harness();
    const res = handleOperator(req('tok-op', 'POST', '/operator/nonsense', { accountId: 'a' }), deps);
    expect(res.status).toBe(404);
  });
});
