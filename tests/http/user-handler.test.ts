// Phase F — the user-app management endpoints (DECISIONS_PHASE_F_G.md F2, F6).
// Behind the user auth seam, acting only on the caller's own account.

import { Machine } from '../../src/domain/machine';
import type { Contact } from '../../src/console';
import type { ContentPolicy } from '../../src/domain/payload';
import {
  ContactRepository,
  InMemoryKeyValueStore,
  MachineRepository,
  PayloadRepository,
  RecipientOrderRepository,
} from '../../src/persistence';
import { AuthoringService, PeopleService } from '../../src/app';
import { DevAuthenticator, handleUser, type HttpRequest } from '../../src/http';
import { T0, machineIn } from '../support/factory';

const POLICY: ContentPolicy = {
  maxBytesByKind: { note: 10_000, photo: 5_000_000, pdf: 10_000_000 },
  allowedMimeTypes: { note: ['text/plain'], photo: ['image/jpeg'], pdf: ['application/pdf'] },
};

function contact(id: string): Contact {
  return { id, name: id, group: 'family', roles: ['confirmer'], email: `${id}@t.test`, phone: '+1', consentAt: null, stale: false };
}

function harness() {
  const store = new InMemoryKeyValueStore();
  const machines = new MachineRepository(store);
  const contacts = new ContactRepository(store);
  const payloads = new PayloadRepository(store);
  const recipientOrders = new RecipientOrderRepository(store);
  const people = new PeopleService({ contacts, machines, recipientOrders });
  const authoring = new AuthoringService({ payloads, contacts, machines, policy: POLICY });
  machines.save('a', Machine.restore(machineIn('ACTIVE')));
  const authenticator = new DevAuthenticator({
    'tok-a': { kind: 'user', id: 'u1', accountId: 'a' },
    'tok-op': { kind: 'operator', id: 'op1' },
  });
  const deps = { authenticator, people, authoring, now: () => T0 };
  return { deps, contacts };
}

function req(token: string | undefined, method: string, path: string, body?: unknown): HttpRequest {
  return {
    method,
    path,
    query: {},
    headers: token === undefined ? {} : { authorization: `Bearer ${token}` },
    body: body === undefined ? '' : JSON.stringify(body),
    contentType: 'application/json',
  };
}

describe('handleUser', () => {
  it('401s an unauthenticated request', () => {
    const { deps } = harness();
    expect(handleUser(req(undefined, 'GET', '/me/contacts'), deps).status).toBe(401);
  });

  it('403s a non-user principal', () => {
    const { deps } = harness();
    expect(handleUser(req('tok-op', 'GET', '/me/contacts'), deps).status).toBe(403);
  });

  it('adds and lists the caller’s own contacts (no accountId in the body)', () => {
    const { deps } = harness();
    const add = handleUser(req('tok-a', 'POST', '/me/contacts', { contact: contact('c1') }), deps);
    expect(add.status).toBe(200);
    const list = handleUser(req('tok-a', 'GET', '/me/contacts'), deps);
    expect(JSON.parse(list.body).contacts.map((c: Contact) => c.id)).toEqual(['c1']);
  });

  it('rejects an invalid recipient order with 409', () => {
    const { deps } = harness();
    handleUser(req('tok-a', 'POST', '/me/contacts', { contact: { ...contact('r1'), roles: ['recipient'] } }), deps);
    const res = handleUser(req('tok-a', 'POST', '/me/recipient-order', { order: ['nobody'] }), deps);
    expect(res.status).toBe(409);
  });

  it('saves content addressed to a recipient', () => {
    const { deps } = harness();
    handleUser(req('tok-a', 'POST', '/me/contacts', { contact: { ...contact('r1'), roles: ['recipient'] } }), deps);
    const payload = {
      id: 'p1', kind: 'note', mimeType: 'text/plain', byteSize: 100,
      envelope: { algorithm: 'AES-256-GCM', keyId: 'k', encryptedDataKey: 'edk', iv: 'iv', ciphertext: 'ct', version: 1 },
      recipientIds: ['r1'], version: 1, createdAt: T0, updatedAt: T0,
    };
    const res = handleUser(req('tok-a', 'POST', '/me/content', { payload }), deps);
    expect(res.status).toBe(200);
  });

  it('404s an unknown route', () => {
    const { deps } = harness();
    expect(handleUser(req('tok-a', 'POST', '/me/nonsense', {}), deps).status).toBe(404);
  });
});
