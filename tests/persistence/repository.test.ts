// Phase D — state repositories (DECISIONS.md §12 Phase D). The promise is that
// accounts, machine context (with confirmations), payloads, operator case files,
// and delivery records survive a restart, while the domain stays pure and no
// state is ever written except through `transition`.

import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { Machine } from '../../src/domain/machine';
import { DAY_MS } from '../../src/domain/config';
import type { Payload } from '../../src/domain/payload';
import { OperatorConsole } from '../../src/console/console';
import type { Contact } from '../../src/console/contacts';
import { ReleaseController } from '../../src/delivery/release';
import {
  AccountRepository,
  CaseFileRepository,
  ContactRepository,
  DeliveryRepository,
  FileKeyValueStore,
  InMemoryKeyValueStore,
  MachineRepository,
  PayloadRepository,
  type AccountRecord,
} from '../../src/persistence';

const T0 = 1_700_000_000_000;

function samplePayload(id: string): Payload {
  return {
    id,
    kind: 'note',
    mimeType: 'text/plain',
    byteSize: 12,
    envelope: {
      algorithm: 'AES-256-GCM',
      keyId: 'kms-1',
      encryptedDataKey: 'wrapped-key',
      iv: 'iv-bytes',
      ciphertext: 'cipher-bytes',
      version: 1,
    },
    recipientIds: ['r-1'],
    version: 1,
    createdAt: T0,
    updatedAt: T0,
  };
}

function sampleContact(id: string, group: Contact['group']): Contact {
  return {
    id,
    name: 'Test Person',
    group,
    roles: ['confirmer', 'recipient'],
    email: `${id}@example.com`,
    phone: `+880${id}`,
    consentAt: T0,
    stale: false,
  };
}

describe('KeyValueStore backends', () => {
  it('in-memory: get/set/delete/keys', () => {
    const kv = new InMemoryKeyValueStore();
    kv.set('a', '1');
    kv.set('b', '2');
    expect(kv.get('a')).toBe('1');
    expect([...kv.keys()].sort()).toEqual(['a', 'b']);
    kv.delete('a');
    expect(kv.get('a')).toBeUndefined();
  });

  it('file-backed: state survives a restart', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lv-kv-'));
    try {
      const file = path.join(dir, 'state.json');
      const first = new FileKeyValueStore(file);
      first.set('x', 'hello');
      const reloaded = new FileKeyValueStore(file);
      expect(reloaded.get('x')).toBe('hello');
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

describe('MachineRepository — machine state (with confirmations) survives a restart', () => {
  it('reloads the exact context after transitions, and continues via transition', () => {
    const kv = new InMemoryKeyValueStore();
    const repo = new MachineRepository(kv);

    // Drive the machine forward through the guarded transition function only.
    const machine = new Machine({ now: T0 });
    machine.apply({ type: 'MISSED_CHECK_IN', at: T0 + 8 * DAY_MS });
    machine.apply({ type: 'REACH_VERIFYING', at: T0 + 31 * DAY_MS });
    machine.apply({
      type: 'RECORD_CONFIRMATION',
      at: T0 + 31 * DAY_MS,
      confirmation: { contactId: 'c1', group: 'family', recordingOperatorId: 'op', at: T0 + 31 * DAY_MS },
    });
    repo.save('acct-1', machine);

    // "Restart": a brand-new repo/machine rebuilt from the snapshot.
    const restored = repo.load('acct-1')!;
    expect(restored.state).toBe('VERIFYING');
    expect(restored.context.confirmations).toHaveLength(1);
    expect(restored.context.confirmations[0]!.group).toBe('family');

    // The restored machine keeps moving through `transition` — a live check-in
    // returns it to ACTIVE and wipes confirmations, exactly as the guard says.
    const result = restored.apply({ type: 'CHECK_IN', at: T0 + 32 * DAY_MS });
    expect(result.ok).toBe(true);
    expect(restored.state).toBe('ACTIVE');
    expect(restored.context.confirmations).toHaveLength(0);
  });

  it('load returns undefined for an unknown account', () => {
    const repo = new MachineRepository(new InMemoryKeyValueStore());
    expect(repo.load('nope')).toBeUndefined();
  });
});

describe('PayloadRepository — ciphertext-only content, per account', () => {
  it('saves, gets, lists, and deletes payloads scoped by account', () => {
    const repo = new PayloadRepository(new InMemoryKeyValueStore());
    repo.save('acct-1', samplePayload('p1'));
    repo.save('acct-1', samplePayload('p2'));
    repo.save('acct-2', samplePayload('p3'));

    expect(repo.get('acct-1', 'p1')!.id).toBe('p1');
    expect(repo.forAccount('acct-1').map((p) => p.id).sort()).toEqual(['p1', 'p2']);
    expect(repo.forAccount('acct-2').map((p) => p.id)).toEqual(['p3']);

    // The stored record carries only ciphertext, never plaintext.
    const stored = repo.get('acct-1', 'p1')!;
    expect(stored.envelope.ciphertext).toBe('cipher-bytes');
    expect(Object.keys(stored.envelope)).not.toContain('plaintext');

    repo.delete('acct-1', 'p1');
    expect(repo.get('acct-1', 'p1')).toBeUndefined();
  });
});

describe('ContactRepository — roster per account', () => {
  it('round-trips contacts and scopes by account', () => {
    const repo = new ContactRepository(new InMemoryKeyValueStore());
    repo.save('acct-1', sampleContact('c1', 'family'));
    repo.save('acct-1', sampleContact('c2', 'friend'));
    expect(repo.forAccount('acct-1').map((c) => c.id).sort()).toEqual(['c1', 'c2']);
    expect(repo.get('acct-1', 'c1')!.group).toBe('family');
  });
});

describe('AccountRepository', () => {
  it('round-trips account records', () => {
    const repo = new AccountRepository(new InMemoryKeyValueStore());
    const record: AccountRecord = {
      id: 'acct-1',
      createdAt: T0,
      evidenceMode: 'lenient',
      publicReleaseEnabled: false,
      softDeletedAt: null,
    };
    repo.save('acct-1', record);
    expect(repo.get('acct-1')).toEqual(record);
    expect(repo.all()).toHaveLength(1);
  });
});

describe('CaseFileRepository — operational (non-audit) case file survives a restart', () => {
  it('a reloaded console recovers its notes and state tags', () => {
    const contacts = [sampleContact('c1', 'family')];
    const machine = new Machine({ now: T0 });
    const console1 = new OperatorConsole({ machine, contacts });
    console1.recordContactState('c1', 'deceased', 'op-1', T0);
    console1.recordNote('c1', 'spoke with next of kin', 'op-1', T0);
    console1.recordOverallState('deceased', 'op-1', T0);

    const repo = new CaseFileRepository(new InMemoryKeyValueStore());
    repo.save('acct-1', console1.exportCaseFile());

    // Rebuild a fresh console and restore the case file.
    const console2 = new OperatorConsole({ machine: new Machine({ now: T0 }), contacts });
    console2.restoreCaseFile(repo.get('acct-1')!);

    expect(console2.caseFor('c1').state).toBe('deceased');
    expect(console2.caseFor('c1').notes[0]!.text).toBe('spoke with next of kin');
    expect(console2.overallState()).toBe('deceased');
  });
});

describe('DeliveryRepository — delivery progress survives a restart', () => {
  it('a reconstructed controller still authenticates an already-issued code and link', () => {
    const recipients = [
      { recipientId: 'r-1', email: 'r1@example.com', phone: '+8801', payloadIds: ['p1'] },
    ];
    const confirmations = [
      { contactId: 'c-fam', group: 'family' as const, recordingOperatorId: 'op', at: T0 },
      { contactId: 'c-fri', group: 'friend' as const, recordingOperatorId: 'op', at: T0 },
      { contactId: 'c-col', group: 'colleague' as const, recordingOperatorId: 'op', at: T0 },
    ];

    const audit = new Machine({ now: T0 }).audit; // any AuditSink works here
    const controller = new ReleaseController({
      state: 'PRIVATE_RELEASE',
      privateReleasedAt: T0,
      recipients,
      confirmations,
      audit,
      codeGenerator: () => '424242',
      linkGenerator: () => 'link-token-1',
    });
    controller.begin(T0);

    const repo = new DeliveryRepository(new InMemoryKeyValueStore());
    repo.save('acct-1', controller.snapshot());

    // "Restart": a fresh controller, rehydrated from the snapshot.
    const restored = new ReleaseController({
      state: 'PRIVATE_RELEASE',
      privateReleasedAt: T0,
      recipients,
      confirmations,
      audit,
    });
    restored.restore(repo.get('acct-1')!);

    const auth = restored.authenticate('link-token-1', '424242', T0 + DAY_MS);
    expect(auth.ok).toBe(true);
    if (auth.ok) expect(auth.payloadIds).toEqual(['p1']);
  });
});
