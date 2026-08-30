// Phase F — the cancel HTTP server wiring (DECISIONS_PHASE_F_G.md F1).
//
// A thin Node http server that parses a real request into the shape the pure
// handler expects and writes the response back. The handler's behaviour is
// pinned in cancel-handler.test.ts; this only proves the transport glue —
// routing, body reading, headers — over a real socket.

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
import { CancelService } from '../../src/app';
import { createCancelServer, type CancelFallback } from '../../src/http';
import { T0, daysAfter, machineIn } from '../support/factory';

const SECRET = 'test-cancel-secret';
const FALLBACK: CancelFallback = { supportUrl: 'https://support.example', inAppCancelUrl: 'https://app.example/cancel' };

async function request(
  server: http.Server,
  method: string,
  path: string,
  body?: { data: string; contentType: string },
): Promise<{ status: number; body: string }> {
  const { port } = server.address() as AddressInfo;
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, method, path },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: data }));
      },
    );
    req.on('error', reject);
    if (body) {
      req.setHeader('content-type', body.contentType);
      req.write(body.data);
    }
    req.end();
  });
}

describe('createCancelServer', () => {
  let server: http.Server;
  let machines: MachineRepository;
  let token: string;

  beforeEach((done) => {
    machines = new MachineRepository(new InMemoryKeyValueStore());
    const service = new CancelService({
      machines,
      auditFor: () => new HashChainedAuditStore(new InMemoryAppendOnlySink()) as AuditSink,
      secret: SECRET,
    });
    machines.save('acct-1', Machine.restore(machineIn('HOLD')));
    token = service.issueToken('acct-1', T0);
    server = createCancelServer({ service, fallback: FALLBACK, now: () => daysAfter(T0, 40) });
    server.listen(0, '127.0.0.1', done);
  });

  afterEach((done) => {
    server.close(done);
  });

  it('serves the confirm page on GET without mutating', async () => {
    const res = await request(server, 'GET', `/cancel?t=${encodeURIComponent(token)}`);
    expect(res.status).toBe(200);
    expect(res.body.toLowerCase()).toContain('stop everything');
    expect(machines.getContext('acct-1')!.state).toBe('HOLD');
  });

  it('cancels on POST of a url-encoded form body', async () => {
    const res = await request(server, 'POST', '/cancel', {
      data: `t=${encodeURIComponent(token)}`,
      contentType: 'application/x-www-form-urlencoded',
    });
    expect(res.status).toBe(200);
    expect(res.body.toLowerCase()).toContain('everything is stopped');
    expect(machines.getContext('acct-1')!.state).toBe('CANCELLED');
  });

  it('renders the fallback page for a bad token instead of dead-ending', async () => {
    const res = await request(server, 'GET', '/cancel?t=garbage');
    expect(res.status).toBe(200);
    expect(res.body).toContain(FALLBACK.supportUrl);
  });
});
