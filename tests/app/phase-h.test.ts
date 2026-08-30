// Phase H — quarterly drill + public-release publishing.

import type { AuditSink } from '../../src/domain/audit';
import type { Contact } from '../../src/console';
import { Machine } from '../../src/domain/machine';
import {
  ContactRepository,
  HashChainedAuditStore,
  InMemoryAppendOnlySink,
  InMemoryKeyValueStore,
  MachineRepository,
} from '../../src/persistence';
import {
  DrillService,
  PublicReleaseService,
} from '../../src/app';
import {
  InMemoryEmailAdapter,
  InMemoryPublicPublisher,
  InMemorySmsAdapter,
} from '../../src/adapters';
import type { AuditSinkFactory } from '../../src/runtime';
import { T0, machineIn } from '../support/factory';

function contact(id: string): Contact {
  return { id, name: id, group: 'family', roles: ['confirmer'], email: `${id}@t.test`, phone: '+1', consentAt: T0, stale: false };
}

function audit() {
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
  return { auditFor, storeFor };
}

describe('DrillService', () => {
  it('sends a labelled drill on email + SMS and logs it, carrying nothing sensitive', () => {
    const store = new InMemoryKeyValueStore();
    const contacts = new ContactRepository(store);
    contacts.save('a', contact('c1'));
    const email = new InMemoryEmailAdapter();
    const sms = new InMemorySmsAdapter();
    const { auditFor, storeFor } = audit();
    const drill = new DrillService({ contacts, email, sms, auditFor });

    const res = drill.runDrill('a', 'c1', T0);
    expect(res.ok).toBe(true);
    expect(email.sent[0]!.subject.toLowerCase()).toContain('test');
    expect(email.sent[0]!.body).not.toMatch(/code|link|http/i);
    expect(storeFor('a').all().map((e) => e.event)).toContain('QUARTERLY_DRILL');
  });
});

describe('PublicReleaseService', () => {
  it('publishes only when the machine is in PUBLIC_RELEASE', () => {
    const store = new InMemoryKeyValueStore();
    const machines = new MachineRepository(store);
    const publisher = new InMemoryPublicPublisher();
    const { auditFor, storeFor } = audit();
    const service = new PublicReleaseService({ machines, publisher, auditFor });

    machines.save('a', Machine.restore(machineIn('PRIVATE_RELEASE')));
    expect(service.publish('a', T0).ok).toBe(false); // not yet public
    expect(publisher.published).toHaveLength(0);

    machines.save('a', Machine.restore(machineIn('PUBLIC_RELEASE')));
    expect(service.publish('a', T0).ok).toBe(true);
    expect(publisher.published).toHaveLength(1);
    expect(storeFor('a').all().map((e) => e.event)).toContain('PUBLIC_PUBLISH');
  });
});
