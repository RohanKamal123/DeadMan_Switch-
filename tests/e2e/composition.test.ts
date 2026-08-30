// Composition smoke test: boot the wired servers and run a real request path —
// login → authenticated check-in, and the isolated cancel surface.

import { randomBytes } from 'crypto';
import { AddressInfo } from 'node:net';
import * as http from 'node:http';
import type { AuditSink } from '../../src/domain/audit';
import { Machine } from '../../src/domain/machine';
import {
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
import { createServers, type AppConfig } from '../../src/composition';
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
});
