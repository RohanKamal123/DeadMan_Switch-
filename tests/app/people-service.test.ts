// Phase F — the people service (DECISIONS_PHASE_F_G.md F2). Roster + recipient
// order management, with the freeze rule and group immutability enforced.

import type { Group } from '../../src/domain/states';
import { Machine } from '../../src/domain/machine';
import type { Contact } from '../../src/console';
import {
  ContactRepository,
  InMemoryKeyValueStore,
  MachineRepository,
  RecipientOrderRepository,
} from '../../src/persistence';
import { PeopleService } from '../../src/app';
import { T0, machineIn } from '../support/factory';

function contact(id: string, group: Group, roles: Contact['roles']): Contact {
  return { id, name: id, group, roles, email: `${id}@t.test`, phone: `+1${id}`, consentAt: null, stale: false };
}

function harness(state: Parameters<typeof machineIn>[0] = 'ACTIVE') {
  const store = new InMemoryKeyValueStore();
  const machines = new MachineRepository(store);
  const contacts = new ContactRepository(store);
  const recipientOrders = new RecipientOrderRepository(store);
  const people = new PeopleService({ contacts, machines, recipientOrders });
  machines.save('a', Machine.restore(machineIn(state)));
  return { people, contacts, machines };
}

describe('PeopleService', () => {
  it('adds and lists contacts', () => {
    const h = harness();
    expect(h.people.addContact('a', contact('c1', 'family', ['confirmer'])).ok).toBe(true);
    expect(h.people.listContacts('a').map((c) => c.id)).toEqual(['c1']);
  });

  it('records consent (stamps the timestamp once)', () => {
    const h = harness();
    h.people.addContact('a', contact('c1', 'family', ['confirmer']));
    expect(h.people.recordConsent('a', 'c1', T0).ok).toBe(true);
    expect(h.contacts.get('a', 'c1')!.consentAt).toBe(T0);
  });

  it('updates whitelisted fields but never the group (invariant 4 source of truth)', () => {
    const h = harness();
    h.people.addContact('a', contact('c1', 'family', ['confirmer']));
    h.people.updateContact('a', 'c1', { email: 'new@t.test', roles: ['confirmer', 'recipient'] });
    const c = h.contacts.get('a', 'c1')!;
    expect(c.email).toBe('new@t.test');
    expect(c.roles).toContain('recipient');
    expect(c.group).toBe('family'); // unchanged — no path edits it
  });

  it('freezes all roster mutations once a release is pending (HOLD)', () => {
    const h = harness('HOLD');
    const res = h.people.addContact('a', contact('c1', 'family', ['confirmer']));
    expect(res.ok).toBe(false);
    expect(h.people.listContacts('a')).toHaveLength(0);
  });

  it('sets a recipient order that covers every recipient, rejecting gaps and non-recipients', () => {
    const h = harness();
    h.people.addContact('a', contact('r1', 'family', ['recipient']));
    h.people.addContact('a', contact('r2', 'friend', ['recipient']));
    h.people.addContact('a', contact('c1', 'other', ['confirmer']));

    expect(h.people.setRecipientOrder('a', ['r1']).ok).toBe(false); // missing r2
    expect(h.people.setRecipientOrder('a', ['r1', 'c1']).ok).toBe(false); // c1 not a recipient
    expect(h.people.setRecipientOrder('a', ['r2', 'r1']).ok).toBe(true);
    expect(h.people.getRecipientOrder('a')).toEqual(['r2', 'r1']);
  });

  it('an unknown account fails safe', () => {
    const h = harness();
    expect(h.people.addContact('ghost', contact('c1', 'family', ['confirmer'])).ok).toBe(false);
  });
});
