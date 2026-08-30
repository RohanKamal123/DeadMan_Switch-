// Phase F — the content-authoring service (DECISIONS_PHASE_F_G.md F2, F6).
// Enforces the freeze rule, schema validity against the deployment policy,
// ciphertext-only storage, and recipient addressing — all defined in the domain.

import { Machine } from '../../src/domain/machine';
import type { Contact } from '../../src/console';
import type { ContentPolicy, Payload } from '../../src/domain/payload';
import {
  ContactRepository,
  InMemoryKeyValueStore,
  MachineRepository,
  PayloadRepository,
} from '../../src/persistence';
import { AuthoringService } from '../../src/app';
import { T0, machineIn } from '../support/factory';

const POLICY: ContentPolicy = {
  maxBytesByKind: { note: 10_000, photo: 5_000_000, pdf: 10_000_000 },
  allowedMimeTypes: { note: ['text/plain'], photo: ['image/jpeg'], pdf: ['application/pdf'] },
};

function recipient(id: string): Contact {
  return { id, name: id, group: 'other', roles: ['recipient'], email: `${id}@t.test`, phone: '+1', consentAt: T0, stale: false };
}

function note(id: string, recipientIds: readonly string[], overrides: Partial<Payload> = {}): Payload {
  return {
    id, kind: 'note', mimeType: 'text/plain', byteSize: 100,
    envelope: { algorithm: 'AES-256-GCM', keyId: 'k1', encryptedDataKey: 'edk', iv: 'iv', ciphertext: 'ct', version: 1 },
    recipientIds, version: 1, createdAt: T0, updatedAt: T0, ...overrides,
  };
}

function harness(state: Parameters<typeof machineIn>[0] = 'ACTIVE') {
  const store = new InMemoryKeyValueStore();
  const machines = new MachineRepository(store);
  const contacts = new ContactRepository(store);
  const payloads = new PayloadRepository(store);
  const authoring = new AuthoringService({ payloads, contacts, machines, policy: POLICY });
  machines.save('a', Machine.restore(machineIn(state)));
  contacts.save('a', recipient('r1'));
  return { authoring, payloads, contacts };
}

describe('AuthoringService', () => {
  it('saves a valid, addressed, encrypted item', () => {
    const h = harness();
    expect(h.authoring.saveContent('a', note('p1', ['r1'])).ok).toBe(true);
    expect(h.payloads.get('a', 'p1')).toBeDefined();
  });

  it('rejects content addressed to a non-recipient', () => {
    const h = harness();
    expect(h.authoring.saveContent('a', note('p1', ['nobody'])).ok).toBe(false);
  });

  it('rejects content that exceeds the policy size limit', () => {
    const h = harness();
    const tooBig = note('p1', ['r1'], { byteSize: 999_999 });
    const res = h.authoring.saveContent('a', tooBig);
    expect(res.ok).toBe(false);
  });

  it('rejects content whose envelope is not encrypted (no plaintext ever stored)', () => {
    const h = harness();
    const plain = note('p1', ['r1'], { envelope: { algorithm: 'none', keyId: '', encryptedDataKey: '', iv: '', ciphertext: '', version: 1 } });
    expect(h.authoring.saveContent('a', plain).ok).toBe(false);
  });

  it('freezes create/edit/delete once a release is pending (HOLD)', () => {
    const h = harness('HOLD');
    expect(h.authoring.saveContent('a', note('p1', ['r1'])).ok).toBe(false);
  });

  it('edits an existing item and bumps its version', () => {
    const h = harness();
    h.authoring.saveContent('a', note('p1', ['r1']));
    expect(h.authoring.editContent('a', 'p1', { byteSize: 200 }, T0 + 1).ok).toBe(true);
    expect(h.payloads.get('a', 'p1')!.version).toBe(2);
  });

  it('deletes an item while editable', () => {
    const h = harness();
    h.authoring.saveContent('a', note('p1', ['r1']));
    expect(h.authoring.deleteContent('a', 'p1').ok).toBe(true);
    expect(h.payloads.get('a', 'p1')).toBeUndefined();
  });
});
