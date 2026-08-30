// Phase F — the release application service (DECISIONS_PHASE_F_G.md F4).
//
// Drives the private-release delivery engine over persisted state. It reconstructs
// the controller from the persisted plan + delivery snapshot so a returning
// recipient authenticates across a restart, and it never invents a recipient
// order — `begin` receives the user-defined order (§7). These tests pin the
// recipient-facing flow: activate, gated authenticate, expiry, reissue, the
// 14-day fallback, and access denial once the account leaves a release state.

import type { AuditSink } from '../../src/domain/audit';
import { CODE_EXPIRY_HOURS, HOUR_MS } from '../../src/domain/config';
import type { Group, State } from '../../src/domain/states';
import { Machine } from '../../src/domain/machine';
import type { Contact } from '../../src/console';
import type { DeliveryMessage } from '../../src/delivery';
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
import { ReleaseService } from '../../src/app';
import type { AuditSinkFactory } from '../../src/runtime';
import { T0, daysAfter, machineIn } from '../support/factory';

const RELEASED_AT = daysAfter(T0, 62); // matches machineIn('PRIVATE_RELEASE')

function recipient(id: string, group: Group = 'other'): Contact {
  return { id, name: id, group, roles: ['recipient'], email: `${id}@t.test`, phone: `+1${id}`, consentAt: T0, stale: false };
}

function payload(id: string, recipientIds: readonly string[]): Payload {
  return {
    id,
    kind: 'note',
    mimeType: 'text/plain',
    byteSize: 10,
    envelope: { algorithm: 'AES-256-GCM', keyId: 'k1', encryptedDataKey: 'edk', iv: 'iv', ciphertext: 'ct', version: 1 },
    recipientIds,
    version: 1,
    createdAt: T0,
    updatedAt: T0,
  };
}

function linkOf(messages: readonly DeliveryMessage[]): string {
  const email = messages.find((m) => m.channel === 'email');
  if (email === undefined || email.channel !== 'email') throw new Error('no email message');
  return email.gatedLink;
}
function codeOf(messages: readonly DeliveryMessage[]): string {
  const sms = messages.find((m) => m.channel === 'sms');
  if (sms === undefined || sms.channel !== 'sms') throw new Error('no sms message');
  return sms.code;
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
  const service = new ReleaseService({ machines, contacts, payloads, plans, deliveries, auditFor });

  machines.save('a', Machine.restore(machineIn('PRIVATE_RELEASE')));
  contacts.save('a', recipient('r1'));
  contacts.save('a', recipient('r2'));
  payloads.save('a', payload('p1', ['r1']));
  payloads.save('a', payload('p2', ['r2']));

  const setState = (state: State): void => {
    machines.save('a', Machine.restore(machineIn(state, { privateReleasedAt: RELEASED_AT })));
  };
  return { service, machines, plans, deliveries, storeFor, setState };
}

describe('ReleaseService', () => {
  it('begin activates the first recipient with a gated email + a separate-channel code, and persists', () => {
    const h = harness();
    const begun = h.service.begin('a', ['r1', 'r2'], RELEASED_AT);
    expect(begun.ok).toBe(true);
    if (begun.ok) {
      expect(begun.messages.map((m) => m.channel).sort()).toEqual(['email', 'sms']);
    }
    expect(h.plans.get('a')!.recipients.map((r) => r.recipientId)).toEqual(['r1', 'r2']);
    expect(h.deliveries.get('a')).toBeDefined();
  });

  it('the gated page authenticates the link + code and returns the addressed items', () => {
    const h = harness();
    const begun = h.service.begin('a', ['r1', 'r2'], RELEASED_AT);
    if (!begun.ok) throw new Error('begin failed');
    const at = RELEASED_AT + HOUR_MS;
    const res = h.service.authenticate('a', linkOf(begun.messages), codeOf(begun.messages), at);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.payloadIds).toEqual(['p1']);
  });

  it('logs the access as metadata only, on the durable trail (invariant 6/7)', () => {
    const h = harness();
    const begun = h.service.begin('a', ['r1'], RELEASED_AT);
    if (!begun.ok) throw new Error('begin failed');
    h.service.authenticate('a', linkOf(begun.messages), codeOf(begun.messages), RELEASED_AT + HOUR_MS);
    const store = h.storeFor('a');
    expect(store.verify().ok).toBe(true);
    const events = store.all().map((e) => e.event);
    expect(events).toContain('RELEASE_ACTIVATE');
    expect(events).toContain('RELEASE_ACCESS');
  });

  it('rejects a wrong code and an expired code', () => {
    const h = harness();
    const begun = h.service.begin('a', ['r1'], RELEASED_AT);
    if (!begun.ok) throw new Error('begin failed');
    const link = linkOf(begun.messages);
    expect(h.service.authenticate('a', link, '000000', RELEASED_AT + HOUR_MS).ok).toBe(false);
    const afterExpiry = RELEASED_AT + (CODE_EXPIRY_HOURS + 1) * HOUR_MS;
    expect(h.service.authenticate('a', link, codeOf(begun.messages), afterExpiry).ok).toBe(false);
  });

  it('re-issues a fresh code by link; the new code works, the old one does not', () => {
    const h = harness();
    const begun = h.service.begin('a', ['r1'], RELEASED_AT);
    if (!begun.ok) throw new Error('begin failed');
    const link = linkOf(begun.messages);
    const oldCode = codeOf(begun.messages);

    const reissued = h.service.reissueByLink('a', link, RELEASED_AT + HOUR_MS);
    expect(reissued.ok).toBe(true);
    if (!reissued.ok) throw new Error('reissue failed');
    const newCode = reissued.sms.code;

    const at = RELEASED_AT + 2 * HOUR_MS;
    expect(h.service.authenticate('a', link, oldCode, at).ok).toBe(false);
    expect(h.service.authenticate('a', link, newCode, at).ok).toBe(true);
  });

  it('falls back to the next recipient after 14 days of silence (11.4)', () => {
    const h = harness();
    h.service.begin('a', ['r1', 'r2'], RELEASED_AT);
    // No access from r1; 14 days later the next recipient is activated.
    const step = h.service.advanceFallback('a', RELEASED_AT + 14 * 24 * HOUR_MS);
    expect(step.messages.map((m) => m.channel).sort()).toEqual(['email', 'sms']);
  });

  it('begin refuses unless the account is in PRIVATE_RELEASE', () => {
    const h = harness();
    h.setState('HOLD');
    expect(h.service.begin('a', ['r1'], RELEASED_AT).ok).toBe(false);
  });

  it('denies gated access once the account leaves a release state (e.g. a later cancel)', () => {
    const h = harness();
    const begun = h.service.begin('a', ['r1'], RELEASED_AT);
    if (!begun.ok) throw new Error('begin failed');
    const link = linkOf(begun.messages);
    const code = codeOf(begun.messages);
    h.setState('CANCELLED');
    const res = h.service.authenticate('a', link, code, RELEASED_AT + HOUR_MS);
    expect(res.ok).toBe(false);
  });
});
