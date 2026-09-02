// Phase F — the recipient gated-page endpoint (DECISIONS_PHASE_F_G.md F4; G2).
//
// No auth seam here — the capability is the gated link (email) + the one-time
// code (SMS), the deliberate F3 exception. A pure handler over a parsed request.
// It reveals content only after both are presented, never dead-ends, and never
// puts the code in a URL or content/code/recipient on a page (invariant 6). Since
// G2, "reveals content" means the actual decrypted note/photo/pdf, not a count.

import { randomBytes } from 'crypto';
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
import { T0, daysAfter, machineIn } from '../support/factory';

const RELEASED_AT = daysAfter(T0, 62);
const SECRET_TEXT = 'The safe combination is 14-27-8.';

function recipient(id: string, group: Group = 'other'): Contact {
  return { id, name: id, group, roles: ['recipient'], email: `${id}@t.test`, phone: `+1${id}`, consentAt: T0, stale: false };
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
  const crypto = new EnvelopeCrypto(new LocalKeyWrapper({ keyId: 'k1', masterKey: randomBytes(32) }));
  const release = new ReleaseService({ machines, contacts, payloads, plans, deliveries, auditFor, crypto });
  machines.save('a', Machine.restore(machineIn('PRIVATE_RELEASE')));
  contacts.save('a', recipient('r1'));
  const payload: Payload = {
    id: 'p1', kind: 'note', mimeType: 'text/plain', byteSize: SECRET_TEXT.length,
    envelope: crypto.seal(SECRET_TEXT), recipientIds: ['r1'], version: 1, createdAt: T0, updatedAt: T0,
  };
  payloads.save('a', payload);
  const begun = release.begin('a', ['r1'], RELEASED_AT);
  if (!begun.ok) throw new Error('begin failed');
  const link = linkOf(begun.messages);
  const code = codeOf(begun.messages);
  const deps = { release, now: () => RELEASED_AT + HOUR_MS };
  return { deps, link, code };
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
  it('serves the code-entry form on GET (no login required — the F3 exception)', async () => {
    const { deps, link } = harness();
    const res = await handleRecipient(get({ a: 'a', link }), deps);
    expect(res.status).toBe(200);
    expect(res.body.toLowerCase()).toContain('one-time code');
    expect(res.headers['content-type']).toContain('text/html');
  });

  it('shows a generic "not recognised" page when the link is missing (no dead-end, no leak)', async () => {
    const { deps } = harness();
    const res = await handleRecipient(get({ a: 'a' }), deps);
    expect(res.status).toBe(200);
    expect(res.body.toLowerCase()).toContain("isn");
  });

  it('unlocks on the correct link + code and reveals the actual decrypted content (G2)', async () => {
    const { deps, link, code } = harness();
    const res = await handleRecipient(form('/release', { a: 'a', link, code }), deps);
    expect(res.status).toBe(200);
    expect(res.body.toLowerCase()).toContain('unlocked');
    expect(res.body).toContain(SECRET_TEXT);
  });

  it('marks the unlocked response no-store (real decrypted content must never be cached)', async () => {
    const { deps, link, code } = harness();
    const res = await handleRecipient(form('/release', { a: 'a', link, code }), deps);
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('shows a retry page on a wrong code, offering a fresh one', async () => {
    const { deps, link } = harness();
    const res = await handleRecipient(form('/release', { a: 'a', link, code: '000000' }), deps);
    expect(res.status).toBe(200);
    expect(res.body.toLowerCase()).toContain("couldn");
    expect(res.body).toContain('/release/resend');
  });

  it('re-issues a code on resend and returns to the entry form with a notice', async () => {
    const { deps, link } = harness();
    const res = await handleRecipient(form('/release/resend', { a: 'a', link }), deps);
    expect(res.status).toBe(200);
    expect(res.body.toLowerCase()).toContain('new code has been sent');
  });

  it('never puts the code in a URL and never renders the account or recipient id', async () => {
    const { deps, link, code } = harness();
    const unlocked = await handleRecipient(form('/release', { a: 'a', link, code }), deps);
    expect(unlocked.body).not.toContain(code);
    expect(unlocked.body).not.toContain('r1');
  });
});
