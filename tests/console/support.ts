// Shared setup for operator-console tests: a standard contact roster and a
// Machine already driven to VERIFYING (the state in which an operator works).

import { Machine } from '../../src/domain/machine';
import type { Contact } from '../../src/console/contacts';
import { OperatorConsole } from '../../src/console/console';
import { T0, daysAfter } from '../support/factory';

export const AT_CONFIRM = daysAfter(T0, 31);

/**
 * A roster covering the cases the console must handle: consented confirmers in
 * distinct groups, a confirmer who is also a recipient (self-dealing), a
 * recipient-only contact, a consent-pending contact, and a stale contact.
 */
export function standardRoster(): Contact[] {
  return [
    { id: 'c-fam', name: 'Ama', group: 'family', roles: ['confirmer'], email: 'ama@x.example', phone: null, consentAt: T0, stale: false },
    { id: 'c-fri', name: 'Bilal', group: 'friend', roles: ['confirmer'], email: null, phone: '+880100', consentAt: T0, stale: false },
    { id: 'c-col', name: 'Chandni', group: 'colleague', roles: ['confirmer'], email: 'ch@x.example', phone: null, consentAt: T0, stale: false },
    { id: 'c-both', name: 'Dip', group: 'other', roles: ['confirmer', 'recipient'], email: 'dip@x.example', phone: null, consentAt: T0, stale: false },
    { id: 'r-1', name: 'Esha', group: 'friend', roles: ['recipient'], email: 'esha@x.example', phone: '+880200', consentAt: T0, stale: false },
    { id: 'c-pending', name: 'Farid', group: 'family', roles: ['confirmer'], email: 'far@x.example', phone: null, consentAt: null, stale: false },
    { id: 'c-stale', name: 'Gita', group: 'colleague', roles: ['confirmer'], email: 'gita-old@x.example', phone: null, consentAt: T0, stale: true },
  ];
}

export function verifyingMachine(): Machine {
  const m = new Machine({ now: T0, evidenceMode: 'lenient', publicReleaseEnabled: true });
  m.apply({ type: 'MISSED_CHECK_IN', at: daysAfter(T0, 7) });
  m.apply({ type: 'REACH_VERIFYING', at: daysAfter(T0, 30) });
  return m;
}

export function verifyingConsole(): OperatorConsole {
  return new OperatorConsole({
    machine: verifyingMachine(),
    contacts: standardRoster(),
    recipientOrder: ['c-both', 'r-1'],
  });
}
