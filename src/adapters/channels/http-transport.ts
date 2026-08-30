// Phase G — a tiny HTTP(S) transport for the real vendor adapters
// (DECISIONS_PHASE_F_G.md G1). Built on Node's own `http`/`https` — NO vendor
// SDK and no third-party HTTP client, so nothing new enters the supply chain
// (the framework/dependency rule, F0) and no SDK import escapes this adapter
// directory. Every real adapter (Twilio SMS, the VPS storage, HTTP email) speaks
// to its vendor through this one function.
//
// The transport is injectable: adapters accept a `HttpTransport` so tests drive
// them against a fake without touching the network, and production passes
// `nodeHttpTransport`.

import { request as httpsRequest } from 'node:https';
import { request as httpRequest } from 'node:http';

export interface HttpTransportRequest {
  readonly method: string;
  readonly url: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string;
  /** Abort the request after this many ms (fail closed → delay, never hang). */
  readonly timeoutMs?: number;
}

export interface HttpTransportResponse {
  readonly status: number;
  readonly body: string;
}

export type HttpTransport = (req: HttpTransportRequest) => Promise<HttpTransportResponse>;

const DEFAULT_TIMEOUT_MS = 10_000;

/** The production transport: one request over Node's built-in http/https. */
export const nodeHttpTransport: HttpTransport = (req) =>
  new Promise<HttpTransportResponse>((resolve, reject) => {
    let url: URL;
    try {
      url = new URL(req.url);
    } catch {
      reject(new Error('invalid url'));
      return;
    }
    const send = url.protocol === 'http:' ? httpRequest : httpsRequest;
    const headers: Record<string, string> = { ...(req.headers ?? {}) };
    if (req.body !== undefined && headers['content-length'] === undefined) {
      headers['content-length'] = String(Buffer.byteLength(req.body));
    }
    const clientReq = send(
      url,
      { method: req.method, headers, timeout: req.timeoutMs ?? DEFAULT_TIMEOUT_MS },
      (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: data }));
      },
    );
    clientReq.on('timeout', () => clientReq.destroy(new Error('request timed out')));
    clientReq.on('error', reject);
    if (req.body !== undefined) clientReq.write(req.body);
    clientReq.end();
  });

/** True for a 2xx status. */
export function isOk(status: number): boolean {
  return status >= 200 && status < 300;
}

/**
 * Tracks in-flight fire-and-forget requests so a caller (or a test) can wait for
 * them to settle. The real adapters return `void` from their port methods — the
 * network call runs in the background — so this lets tests assert on the result
 * deterministically via `drain()`, and lets ops flush before shutdown.
 */
export class InFlight {
  private readonly pending = new Set<Promise<unknown>>();

  track<T>(promise: Promise<T>): Promise<T> {
    this.pending.add(promise);
    void promise.catch(() => undefined).finally(() => this.pending.delete(promise));
    return promise;
  }

  async drain(): Promise<void> {
    await Promise.allSettled([...this.pending]);
  }
}
