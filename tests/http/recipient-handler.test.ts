// Phase F — the recipient gated-page endpoint (DECISIONS_PHASE_F_G.md F4).
//
// No auth seam here — the capability is the gated link (email) + the one-time
// code (SMS), the deliberate F3 exception. A pure handler over a parsed request.
// It reveals content only after both are presented, never dead-ends, and never
// puts the code in a URL or content/code/recipient on a page (invariant 6).

import type { AuditSink } from '../../src/domain/audit';
import { HOUR_MS } from '../../src/domain/config';
import type { Group } from '../../src/domain/states';
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
import { EnvelopeCrypto, LocalKeyWrapper } from '../../src/adapters/crypto';
import { handleRecipient, type HttpRequest } from '../../src/http';
import { randomBytes } from 'node:crypto';
import { T0, daysAfter, machineIn } from '../support/factory';

const RELEASED_AT = daysAfter(T0, 62);

function recipient(id: string, group: Group = 'other'): Contact {
  return { id, name: id, group, roles: ['recipient'], email: `${id}@t.test`, phone: `+1${id}`, consentAt: T0, stale: false };
}
function payload(id: string, recipientIds: readonly string[]): Payload {
  return {
    id, kind: 'note', mimeType: 'text/plain', byteSize: 10,
    envelope: { algorithm: 'AES-256-GCM', keyId: 'k1', encryptedDataKey: 'edk', iv: 'iv', ciphertext: 'ct', version: 1 },
    recipientIds, version: 1, createdAt: T0, updatedAt: T0,
  };
}
function linkOf(m: readonly DeliveryMessage[]): string {
  const e = m.find((x) => x.channel === 'email');
  if (e?.channel !== 'email') throw new Error('no email');
  return e.gatedLink;
}
function codeOf(m: readonly DeliveryMessage[]): string {
  const s = m.find((x) => x.channel === 'sms');
  if (s?.channel !== 'sms') throw new Error('no sms');
  return s.code;
}

function harness() {
  const store = new InMemoryKeyValueStore();
  const machines = new MachineRepository(store);
  const contacts = new ContactRepository(store);
  const payloads = new PayloadRepository(store);
  const plans = new ReleasePlanRepository(store);
  const deliveries = new DeliveryRepository(store);
  const auditFor = () => new HashChainedAuditStore(new InMemoryAppendOnlySink()) as AuditSink;
  const release = new ReleaseService({ machines, contacts, payloads, plans, deliveries, auditFor });
  machines.save('a', Machine.restore(machineIn('PRIVATE_RELEASE')));
  contacts.save('a', recipient('r1'));
  payloads.save('a', payload('p1', ['r1']));
  const begun = release.begin('a', ['r1'], RELEASED_AT);
  if (!begun.ok) throw new Error('begin failed');
  const link = linkOf(begun.messages);
  const code = codeOf(begun.messages);
  const deps = { release, now: () => RELEASED_AT + HOUR_MS };
  return { deps, link, code };
}

/** A harness that wires real envelope crypto and a sealed note, for the render path. */
function cryptoHarness(noteText: string) {
  const store = new InMemoryKeyValueStore();
  const machines = new MachineRepository(store);
  const contacts = new ContactRepository(store);
  const payloads = new PayloadRepository(store);
  const plans = new ReleasePlanRepository(store);
  const deliveries = new DeliveryRepository(store);
  const auditFor = () => new HashChainedAuditStore(new InMemoryAppendOnlySink()) as AuditSink;
  const crypto = new EnvelopeCrypto(new LocalKeyWrapper({ keyId: 'k1', masterKey: randomBytes(32) }));
  const release = new ReleaseService({ machines, contacts, payloads, plans, deliveries, auditFor, crypto });
  machines.save('a', Machine.restore(machineIn('PRIVATE_RELEASE')));
  contacts.save('a', recipient('r1'));
  payloads.save('a', {
    id: 'p1', kind: 'note', mimeType: 'text/plain', byteSize: Buffer.byteLength(noteText),
    envelope: crypto.seal(noteText), recipientIds: ['r1'], version: 1, createdAt: T0, updatedAt: T0,
  });
  const begun = release.begin('a', ['r1'], RELEASED_AT);
  if (!begun.ok) throw new Error('begin failed');
  return { deps: { release, now: () => RELEASED_AT + HOUR_MS }, link: linkOf(begun.messages), code: codeOf(begun.messages) };
}

function get(query: Record<string, string>): HttpRequest {
  return { method: 'GET', path: '/release', query, body: '' };
}
function form(path: string, fields: Record<string, string>): HttpRequest {
  return {
    method: 'POST',
    path,
    query: {},
    body: new URLSearchParams(fields).toString(),
    contentType: 'application/x-www-form-urlencoded',
  };
}

describe('handleRecipient', () => {
  it('serves the code-entry form on GET (no login required — the F3 exception)', () => {
    const { deps, link } = harness();
    const res = handleRecipient(get({ a: 'a', link }), deps);
    expect(res.status).toBe(200);
    expect(res.body.toLowerCase()).toContain('one-time code');
    expect(res.headers['content-type']).toContain('text/html');
  });

  it('shows a generic "not recognised" page when the link is missing (no dead-end, no leak)', () => {
    const { deps } = harness();
    const res = handleRecipient(get({ a: 'a' }), deps);
    expect(res.status).toBe(200);
    expect(res.body.toLowerCase()).toContain("isn");
  });

  it('unlocks on the correct link + code', () => {
    const { deps, link, code } = harness();
    const res = handleRecipient(form('/release', { a: 'a', link, code }), deps);
    expect(res.status).toBe(200);
    expect(res.body.toLowerCase()).toContain('unlocked');
  });

  it('shows a retry page on a wrong code, offering a fresh one', () => {
    const { deps, link } = harness();
    const res = handleRecipient(form('/release', { a: 'a', link, code: '000000' }), deps);
    expect(res.status).toBe(200);
    expect(res.body.toLowerCase()).toContain("couldn");
    expect(res.body).toContain('/release/resend');
  });

  it('re-issues a code on resend and returns to the entry form with a notice', () => {
    const { deps, link } = harness();
    const res = handleRecipient(form('/release/resend', { a: 'a', link }), deps);
    expect(res.status).toBe(200);
    expect(res.body.toLowerCase()).toContain('new code has been sent');
  });

  it('never puts the code in a URL and never renders the account or recipient id', () => {
    const { deps, link, code } = harness();
    const unlocked = handleRecipient(form('/release', { a: 'a', link, code }), deps);
    // The success page shows only a count, not ids or the code.
    expect(unlocked.body).not.toContain(code);
    expect(unlocked.body).not.toContain('r1');
  });

  it('renders the decrypted note content server-side on the unlocked page (F4/G2)', () => {
    const note = 'Remember to water the roses on Sundays.';
    const { deps, link, code } = cryptoHarness(note);
    const res = handleRecipient(form('/release', { a: 'a', link, code }), deps);
    expect(res.status).toBe(200);
    expect(res.body).toContain(note);
    // Still no code, link, or recipient id in the body (invariant 6).
    expect(res.body).not.toContain(code);
    expect(res.body).not.toContain(link);
    expect(res.body).not.toContain('r1');
  });

  it('escapes decrypted note content so a message cannot inject markup', () => {
    const note = '<script>alert(1)</script>';
    const { deps, link, code } = cryptoHarness(note);
    const res = handleRecipient(form('/release', { a: 'a', link, code }), deps);
    expect(res.body).not.toContain('<script>alert(1)</script>');
    expect(res.body).toContain('&lt;script&gt;');
  });
});
