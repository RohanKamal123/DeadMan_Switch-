// Phase F — the SLO request metrics (DECISIONS_PHASE_F_G.md F7). The server
// records one operational metric per request — path/method/status/duration —
// and never the query string (which carries the cancel token).

import { AddressInfo } from 'node:net';
import * as http from 'node:http';
import { createNodeServer, html, RecordingRequestMetrics, LoggingRequestMetrics, type HttpRequest } from '../../src/http';

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

describe('LoggingRequestMetrics (the real F7 sink)', () => {
  let logSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('logs a routine request to stdout, not stderr', () => {
    const metrics = new LoggingRequestMetrics({ label: 'cancel' });
    metrics.record({ path: '/cancel', method: 'GET', status: 200, durationMs: 5, at: 0 });
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).not.toHaveBeenCalled();
    expect(logSpy.mock.calls[0]![0] as string).toContain('"status":200');
  });

  it('logs a 5xx as an ALERT to stderr', () => {
    const metrics = new LoggingRequestMetrics({ label: 'cancel' });
    metrics.record({ path: '/cancel', method: 'POST', status: 500, durationMs: 5, at: 0 });
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0]![0] as string).toContain('ALERT');
    expect(logSpy).not.toHaveBeenCalled();
  });

  it('logs a request slower than the configured threshold as an ALERT', () => {
    const metrics = new LoggingRequestMetrics({ label: 'cancel', slowMs: 100 });
    metrics.record({ path: '/cancel', method: 'GET', status: 200, durationMs: 150, at: 0 });
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0]![0] as string).toContain('slow request');
  });

  it('a fast, healthy request stays under the default threshold and logs routinely', () => {
    const metrics = new LoggingRequestMetrics({ label: 'cancel' });
    metrics.record({ path: '/cancel', method: 'GET', status: 200, durationMs: 999, at: 0 });
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('never logs the query string or any field beyond path/method/status/duration/at', () => {
    const metrics = new LoggingRequestMetrics({ label: 'cancel' });
    metrics.record({ path: '/cancel', method: 'GET', status: 200, durationMs: 5, at: 123 });
    const line = logSpy.mock.calls[0]![0] as string;
    const parsed = JSON.parse(line.slice(line.indexOf('{'))) as Record<string, unknown>;
    expect(Object.keys(parsed).sort()).toEqual(['at', 'durationMs', 'method', 'path', 'server', 'status']);
  });
});
