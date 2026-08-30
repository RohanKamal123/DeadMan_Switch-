// Phase H — the full-lifecycle end-to-end test (DECISIONS.md §12 Phase H).
//
// ACTIVE → NUDGE → VERIFYING → HOLD → PRIVATE_RELEASE → PUBLIC_RELEASE, driven
// through the REAL persistence layer, the scheduler, the application services,
// and real envelope encryption. It proves the pieces compose: the machine's
// guards hold end to end, content authored while alive decrypts for the right
// recipient after death, and nothing releases before its window.

import { randomBytes } from 'crypto';
import type { AuditSink } from '../../src/domain/audit';
import { HOLD_LENIENT_DAYS, PUBLIC_RELEASE_DELAY_DAYS } from '../../src/domain/config';
import { Machine } from '../../src/domain/machine';
import type { Contact } from '../../src/console';
import type { ContentPolicy } from '../../src/domain/payload';
import {
  CaseFileRepository,
  ContactRepository,
  DeliveryRepository,
  HashChainedAuditStore,
  InMemoryAppendOnlySink,
  InMemoryKeyValueStore,
  MachineRepository,
  PayloadRepository,
  RecipientOrderRepository,
  ReleasePlanRepository,
} from '../../src/persistence';
import {
  AuthoringService,
  OperatorService,
  PeopleService,
  PublicReleaseService,
  ReleaseService,
} from '../../src/app';
import { EnvelopeCrypto, InMemoryPublicPublisher, LocalKeyWrapper } from '../../src/adapters';
import { RecordingReminderSender, Scheduler, type AuditSinkFactory } from '../../src/runtime';
import { T0, daysAfter } from '../support/factory';

const POLICY: ContentPolicy = {
  maxBytesByKind: { note: 100_000, photo: 5_000_000, pdf: 10_000_000 },
  allowedMimeTypes: { note: ['text/plain'], photo: ['image/jpeg'], pdf: ['application/pdf'] },
};

function confirmer(id: string, group: Contact['group']): Contact {
  return { id, name: id, group, roles: ['confirmer'], email: `${id}@t.test`, phone: `+1${id}`, consentAt: T0, stale: false };
}
function recipient(id: string): Contact {
  return { id, name: id, group: 'other', roles: ['recipient'], email: `${id}@t.test`, phone: `+1${id}`, consentAt: T0, stale: false };
}

describe('full lifecycle: ACTIVE → … → PUBLIC_RELEASE', () => {
  it('releases authored content to the right recipient, decryptable, only after every window', () => {
    const store = new InMemoryKeyValueStore();
    const cursorStore = new InMemoryKeyValueStore();
    const machines = new MachineRepository(store);
    const contacts = new ContactRepository(store);
    const payloads = new PayloadRepository(store);
    const plans = new ReleasePlanRepository(store);
    const deliveries = new DeliveryRepository(store);
    const recipientOrders = new RecipientOrderRepository(store);

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

    const people = new PeopleService({ contacts, machines, recipientOrders });
    const authoring = new AuthoringService({ payloads, contacts, machines, policy: POLICY });
    const operators = new OperatorService({ machines, contacts, caseFiles: new CaseFileRepository(store), auditFor });
    const release = new ReleaseService({ machines, contacts, payloads, plans, deliveries, auditFor });
    const publisher = new InMemoryPublicPublisher();
    const publicRelease = new PublicReleaseService({ machines, publisher, auditFor });
    const scheduler = new Scheduler({ machines, cursorStore, auditFor, reminderSender: new RecordingReminderSender() });
    const crypto = new EnvelopeCrypto(new LocalKeyWrapper({ keyId: 'kms-1', masterKey: randomBytes(32) }));

    // --- ACTIVE: set up account, people, content (public enabled) -----------
    machines.save('acct', new Machine({ now: T0, publicReleaseEnabled: true }));
    for (const c of [confirmer('c-fam', 'family'), confirmer('c-fri', 'friend'), confirmer('c-col', 'colleague'), recipient('r1')]) {
      expect(people.addContact('acct', c).ok).toBe(true);
    }
    expect(people.setRecipientOrder('acct', ['r1']).ok).toBe(true);

    const SECRET_MESSAGE = 'To my family: the vault code is in the blue book.';
    const envelope = crypto.seal(SECRET_MESSAGE);
    expect(
      authoring.saveContent('acct', {
        id: 'p1', kind: 'note', mimeType: 'text/plain', byteSize: SECRET_MESSAGE.length,
        envelope, recipientIds: ['r1'], version: 1, createdAt: T0, updatedAt: T0,
      }).ok,
    ).toBe(true);

    // --- no check-in: scheduler advances ACTIVE → NUDGE → VERIFYING (day 30)
    scheduler.tickAccount('acct', daysAfter(T0, 30));
    expect(machines.getContext('acct')!.state).toBe('VERIFYING');

    // --- VERIFYING: operator records 3 confirmations from 3 groups, starts HOLD
    for (const id of ['c-fam', 'c-fri', 'c-col']) {
      expect(operators.recordConfirmation('acct', id, 'op-1', daysAfter(T0, 30)).ok).toBe(true);
    }
    expect(operators.startHold('acct', 'op-1', daysAfter(T0, 30)).ok).toBe(true);
    expect(machines.getContext('acct')!.state).toBe('HOLD');

    // --- HOLD does not release early: a tick before the window changes nothing
    scheduler.tickAccount('acct', daysAfter(T0, 30 + HOLD_LENIENT_DAYS - 1));
    expect(machines.getContext('acct')!.state).toBe('HOLD');

    // --- HOLD window fully elapsed → PRIVATE_RELEASE
    const privateAt = daysAfter(T0, 30 + HOLD_LENIENT_DAYS);
    scheduler.tickAccount('acct', privateAt);
    expect(machines.getContext('acct')!.state).toBe('PRIVATE_RELEASE');

    // --- release engine activates r1; recipient authenticates and DECRYPTS
    const begun = release.begin('acct', people.getRecipientOrder('acct'), privateAt);
    if (!begun.ok) throw new Error('begin failed');
    const email = begun.messages.find((m) => m.channel === 'email');
    const sms = begun.messages.find((m) => m.channel === 'sms');
    if (email?.channel !== 'email' || sms?.channel !== 'sms') throw new Error('missing messages');

    const auth = release.authenticate('acct', email.gatedLink, sms.code, privateAt + 1000);
    expect(auth.ok).toBe(true);
    if (!auth.ok) throw new Error('auth failed');
    expect(auth.payloadIds).toEqual(['p1']);
    const delivered = payloads.get('acct', auth.payloadIds[0]!)!;
    expect(crypto.openToString(delivered.envelope)).toBe(SECRET_MESSAGE);

    // --- PUBLIC_RELEASE only after the 14-day gap
    scheduler.tickAccount('acct', privateAt + (PUBLIC_RELEASE_DELAY_DAYS - 1) * 86_400_000);
    expect(machines.getContext('acct')!.state).toBe('PRIVATE_RELEASE');
    const publicAt = daysAfter(T0, 30 + HOLD_LENIENT_DAYS + PUBLIC_RELEASE_DELAY_DAYS);
    scheduler.tickAccount('acct', publicAt);
    expect(machines.getContext('acct')!.state).toBe('PUBLIC_RELEASE');
    expect(publicRelease.publish('acct', publicAt).ok).toBe(true);
    expect(publisher.published).toHaveLength(1);

    // --- the whole immutable trail verifies (invariant 7)
    expect(storeFor('acct').verify().ok).toBe(true);
  });

  it('a check-in at any point returns to ACTIVE and wipes the process (invariant 1)', () => {
    const store = new InMemoryKeyValueStore();
    const machines = new MachineRepository(store);
    const auditFor: AuditSinkFactory = () => new HashChainedAuditStore(new InMemoryAppendOnlySink()) as AuditSink;
    const scheduler = new Scheduler({ machines, cursorStore: new InMemoryKeyValueStore(), auditFor, reminderSender: new RecordingReminderSender() });

    machines.save('acct', new Machine({ now: T0 }));
    scheduler.tickAccount('acct', daysAfter(T0, 30));
    expect(machines.getContext('acct')!.state).toBe('VERIFYING');

    // The user is alive after all.
    const machine = machines.load('acct', auditFor('acct'))!;
    machine.apply({ type: 'CHECK_IN', at: daysAfter(T0, 31), passive: false });
    machines.save('acct', machine);
    expect(machines.getContext('acct')!.state).toBe('ACTIVE');
    expect(machines.getContext('acct')!.confirmations).toHaveLength(0);
  });
});
