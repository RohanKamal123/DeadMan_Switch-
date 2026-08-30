// Phase F — the thin Node http server for the cancel surface
// (DECISIONS_PHASE_F_G.md F1.4).
//
// This is the ONLY part of the cancel path that touches a socket. It parses a
// request into the `HttpRequest` the pure handler expects, calls the handler,
// and writes the response — no business logic. It imports the app service and
// the handler, but has NO import path to any vendor adapter, so the cancel
// surface can be deployed in its own failure domain (F1.4): its uptime, the
// project's highest SLO (DECISIONS.md 6.1), never depends on email/SMS/storage
// integrations.

import * as http from 'node:http';
import { handleCancel, type CancelHandlerDeps, type HttpRequest } from './cancel-handler';

const MAX_BODY_BYTES = 16 * 1024; // a cancel body is a token; cap to shed abuse.

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

/**
 * Create (but do not start) the cancel server. Call `.listen(...)` on the
 * returned server. Every request routes through the single pure handler, which
 * fails safe on anything unexpected — including a body that never arrives.
 */
export function createCancelServer(deps: CancelHandlerDeps): http.Server {
  return http.createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const query: Record<string, string> = {};
      for (const [key, value] of url.searchParams) query[key] = value;

      let body = '';
      try {
        if (req.method === 'POST') body = await readBody(req);
      } catch {
        // A too-large or aborted body is not a reason to dead-end; the handler
        // treats a missing token as a fail-safe render.
        body = '';
      }

      const contentType = req.headers['content-type'];
      const request: HttpRequest = {
        method: req.method ?? 'GET',
        path: url.pathname,
        query,
        body,
        ...(contentType !== undefined ? { contentType } : {}),
      };

      const response = handleCancel(request, deps);
      res.writeHead(response.status, { ...response.headers });
      res.end(response.body);
    })();
  });
}
