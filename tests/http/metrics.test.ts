// Phase F — the SLO request metrics (DECISIONS_PHASE_F_G.md F7). The server
// records one operational metric per request — path/method/status/duration —
// and never the query string (which carries the cancel token).

import { AddressInfo } from 'node:net';
import * as http from 'node:http';
import { createNodeServer, html, RecordingRequestMetrics, type HttpRequest } from '../../src/http';

function get(server: http.Server, path: string): Promise<void> {
  const { port } = server.address() as AddressInfo;
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method: 'GET', path }, (res) => {
      res.on('data', () => undefined);
      res.on('end', () => resolve());
    });
    req.on('error', reject);
    req.end();
  });
}

describe('createNodeServer metrics (F7)', () => {
  let server: http.Server;
  const metrics = new RecordingRequestMetrics();

  beforeEach((done) => {
    const route = (_req: HttpRequest) => html(200, 'ok');
    server = createNodeServer(route, { metrics });
    server.listen(0, '127.0.0.1', done);
  });
  afterEach((done) => {
    metrics.metrics.length = 0;
    server.close(done);
  });

  it('records path, method, and status but never the query string', async () => {
    await get(server, '/cancel?t=secret-token-value');
    expect(metrics.metrics).toHaveLength(1);
    const m = metrics.metrics[0]!;
    expect(m.path).toBe('/cancel');
    expect(m.method).toBe('GET');
    expect(m.status).toBe(200);
    expect(typeof m.durationMs).toBe('number');
    // The token in the query string must never reach the metric.
    expect(JSON.stringify(m)).not.toContain('secret-token-value');
  });
});
