// Phase F — the thin Node http adapter (DECISIONS_PHASE_F_G.md F0, F1.4).
//
// The ONLY code on any surface that touches a socket. It parses a request into
// the transport-neutral `HttpRequest` a pure handler expects, runs the handler,
// and writes the `HttpResponse` back — no business logic. A `route` is any pure
// function `HttpRequest -> HttpResponse`.
//
// `createCancelServer` builds a server dedicated to the cancel surface. It
// imports only the cancel handler, which has no import path to any vendor
// adapter, so the cancel surface — the project's highest SLO (DECISIONS.md 6.1)
// — can be deployed in its own failure domain (F1.4).

import * as http from 'node:http';
import { handleCancel, type CancelHandlerDeps } from './cancel-handler';
import type { HttpRequest, HttpResponse } from './message';
import type { RequestMetrics } from './metrics';

const MAX_BODY_BYTES = 16 * 1024; // request bodies here are small (a token, a tiny JSON); cap to shed abuse.

export type Route = (req: HttpRequest) => HttpResponse;

export interface NodeServerOptions {
  /** Optional SLO metrics sink (F7). Receives path/method/status/duration only. */
  readonly metrics?: RequestMetrics;
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/** Node's header bag to a plain lower-cased string map (drops array-valued headers to their join). */
function flattenHeaders(raw: http.IncomingHttpHeaders): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (value === undefined) continue;
    out[key.toLowerCase()] = Array.isArray(value) ? value.join(', ') : value;
  }
  return out;
}

/** Wrap a pure route in a Node server. Does not start it — call `.listen(...)`. */
export function createNodeServer(route: Route, options: NodeServerOptions = {}): http.Server {
  const metrics = options.metrics;
  return http.createServer((req, res) => {
    void (async () => {
      const startedAt = Date.now();
      const url = new URL(req.url ?? '/', 'http://localhost');
      const query: Record<string, string> = {};
      for (const [key, value] of url.searchParams) query[key] = value;

      let body = '';
      try {
        if (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') {
          body = await readBody(req);
        }
      } catch {
        // A too-large or aborted body is not a reason to crash; handlers treat a
        // missing/empty body as an invalid request and respond accordingly.
        body = '';
      }

      const headers = flattenHeaders(req.headers);
      const contentType = headers['content-type'];
      const request: HttpRequest = {
        method: req.method ?? 'GET',
        path: url.pathname,
        query,
        headers,
        body,
        ...(contentType !== undefined ? { contentType } : {}),
      };

      let response: HttpResponse;
      try {
        response = route(request);
      } catch {
        // A route should fail safe on its own; this is a last-resort guard so a
        // throwing route never crashes the process.
        response = { status: 500, headers: { 'content-type': 'text/plain; charset=utf-8' }, body: 'error' };
      }
      res.writeHead(response.status, { ...response.headers });
      res.end(response.body);
      if (metrics !== undefined) {
        // Pathname only — never the query string (which carries the cancel token).
        metrics.record({
          path: url.pathname,
          method: req.method ?? 'GET',
          status: response.status,
          durationMs: Date.now() - startedAt,
          at: startedAt,
        });
      }
    })();
  });
}

/** A server dedicated to the cancel surface (its own failure domain, F1.4). */
export function createCancelServer(deps: CancelHandlerDeps, options: NodeServerOptions = {}): http.Server {
  return createNodeServer((req) => handleCancel(req, deps), options);
}
