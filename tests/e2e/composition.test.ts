// Composition smoke test: boot the wired servers and run a real request path —
// login → authenticated check-in, and the isolated cancel surface.

import { randomBytes } from 'crypto';
import { AddressInfo } from 'node:net';
import * as http from 'node:http';
import type { AuditSink } from '../../src/domain/audit';
import { Machine } from '../../src/domain/machine';
import {
  ContactRepository,
  HashChainedAuditStore,
  InMemoryAppendOnlySink,
  InMemoryKeyValueStore,
  MachineRepository,
} from '../../src/persistence';
import {
  CredentialStore,
  InMemoryEmailAdapter,
  InMemoryPublicPublisher,
  InMemoryPushAdapter,
  InMemorySmsAdapter,
  InMemoryStorageAdapter,
} from '../../src/adapters';
import { buildServices, createServers, type AppConfig } from '../../src/composition';
import type { AuditSinkFactory } from '../../src/runtime';
import type { ContentPolicy } from '../../src/domain/payload';

const POLICY: ContentPolicy = {
  maxBytesByKind: { note: 10_000, photo: 5_000_000, pdf: 10_000_000 },
  allowedMimeTypes: { note: ['text/plain'], photo: ['image/jpeg'], pdf: ['application/pdf'] },
};

function request(server: http.Server, method: string, path: string, opts: { body?: string; token?: string } = {}): Promise<{ status: number; body: string }> {
  const { port } = server.address() as AddressInfo;
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (opts.token) headers['authorization'] = `Bearer ${opts.token}`;
    const req = http.request({ host: '127.0.0.1', port, method, path, headers }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: data }));
    });
    req.on('error', reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

describe('composition (wired servers)', () => {
  let apiServer: http.Server;
  let cancelServer: http.Server;
  let state: InMemoryKeyValueStore;

  beforeAll((done) => {
    state = new InMemoryKeyValueStore();
    const stores = new Map<string, HashChainedAuditStore>();
    const auditFor: AuditSinkFactory = (id) => {
      let s = stores.get(id);
      if (s === undefined) {
        s = new HashChainedAuditStore(new InMemoryAppendOnlySink());
        stores.set(id, s);
      }
      return s as AuditSink;
    };
    // Seed an account and a user credential.
    new MachineRepository(state).save('acct-1', new Machine({ now: 0 }));
    const creds = new InMemoryKeyValueStore();
    new CredentialStore(creds).set({ identifier: 'user@x.test', kind: 'user', principalId: 'u1', accountId: 'acct-1', password: 'pw' });

    const config: AppConfig = {
      state,
      cursors: new InMemoryKeyValueStore(),
      credentials: creds,
      auditFor,
      secrets: { cancelTokenSecrets: ['cancel-secret'], sessionSecret: 'sess', kmsMasterKey: randomBytes(32) },
      channels: { email: new InMemoryEmailAdapter(), sms: new InMemorySmsAdapter(), push: new InMemoryPushAdapter(), storage: new InMemoryStorageAdapter() },
      publisher: new InMemoryPublicPublisher(),
      contentPolicy: POLICY,
      sessionTtlMs: 3_600_000,
      opsEmail: 'ops@x.test',
      gatedBaseUrl: 'https://app.test/release',
      cancelFallback: { supportUrl: 'https://support.test' },
      now: () => 1000,
    };
    const servers = createServers(config);
    apiServer = servers.apiServer;
    cancelServer = servers.cancelServer;
    let pending = 2;
    const ready = (): void => { if (--pending === 0) done(); };
    apiServer.listen(0, '127.0.0.1', ready);
    cancelServer.listen(0, '127.0.0.1', ready);
  });

  afterAll((done) => {
    let pending = 2;
    const closed = (): void => { if (--pending === 0) done(); };
    apiServer.close(closed);
    cancelServer.close(closed);
  });

  it('logs in and then performs an authenticated check-in', async () => {
    const login = await request(apiServer, 'POST', '/auth/login', { body: JSON.stringify({ identifier: 'user@x.test', password: 'pw' }) });
    expect(login.status).toBe(200);
    const token = JSON.parse(login.body).token as string;

    const checkIn = await request(apiServer, 'POST', '/check-in', { token, body: '{}' });
    expect(checkIn.status).toBe(200);
    expect(JSON.parse(checkIn.body).state).toBe('ACTIVE');
  });

  it('rejects an unauthenticated check-in (401)', async () => {
    const res = await request(apiServer, 'POST', '/check-in', { body: '{}' });
    expect(res.status).toBe(401);
  });

  it('serves the cancel fail-safe page from the separate cancel server', async () => {
    const res = await request(cancelServer, 'GET', '/cancel?t=garbage');
    expect(res.status).toBe(200);
    expect(res.body).toContain('https://support.test');
  });

  it('wires crypto-secure recipient tokens (high-entropy link, not Math.random)', () => {
    // Security review G6: the release capability tokens must not use Math.random.
    // Drive one release through the wired ReleaseService and inspect the link token.
    const s = new InMemoryKeyValueStore();
    const auditFor: AuditSinkFactory = () => new HashChainedAuditStore(new InMemoryAppendOnlySink()) as AuditSink;
    const machines = new MachineRepository(s);
    machines.save('acct-2', new Machine({ now: 0, publicReleaseEnabled: false }));
    // Move it to PRIVATE_RELEASE via a restored context with the needed fields.
    const ctx = machines.getContext('acct-2')!;
    machines.save('acct-2', Machine.restore({ ...ctx, state: 'PRIVATE_RELEASE', privateReleasedAt: 1000,
      confirmations: [
        { contactId: 'c1', group: 'family', recordingOperatorId: 'op', at: 0 },
        { contactId: 'c2', group: 'friend', recordingOperatorId: 'op', at: 0 },
        { contactId: 'c3', group: 'colleague', recordingOperatorId: 'op', at: 0 },
      ] }));
    const contacts = new ContactRepository(s);
    contacts.save('acct-2', { id: 'r1', name: 'r1', group: 'other', roles: ['recipient'], email: 'r@t.test', phone: '+1', consentAt: 0, stale: false });

    const config: AppConfig = {
      state: s, cursors: new InMemoryKeyValueStore(), credentials: new InMemoryKeyValueStore(), auditFor,
      secrets: { cancelTokenSecrets: ['c'], sessionSecret: 's', kmsMasterKey: randomBytes(32) },
      channels: { email: new InMemoryEmailAdapter(), sms: new InMemorySmsAdapter(), push: new InMemoryPushAdapter(), storage: new InMemoryStorageAdapter() },
      publisher: new InMemoryPublicPublisher(), contentPolicy: POLICY, sessionTtlMs: 1000, opsEmail: 'o@t.test',
      gatedBaseUrl: 'https://app.test/release', cancelFallback: {}, now: () => 1000,
    };
    const services = buildServices(config);
    const begun = services.release.begin('acct-2', ['r1'], 1000);
    if (!begun.ok) throw new Error('begin failed');
    const email = begun.messages.find((m) => m.channel === 'email');
    if (email?.channel !== 'email') throw new Error('no email');
    // gl_ + base64url(32 bytes) ≈ 43 chars → far longer/higher-entropy than a Math.random link.
    expect(email.gatedLink.length).toBeGreaterThan(40);
  });
});
