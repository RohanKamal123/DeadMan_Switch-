// Phase F — the transport-neutral request/response shapes and response helpers
// (DECISIONS_PHASE_F_G.md F0). Handlers are pure functions from `HttpRequest` to
// `HttpResponse`, so they are tested without a socket; the Node adapter
// (`node-adapter.ts`) is the only code that touches the wire.

export interface HttpRequest {
  readonly method: string;
  readonly path: string;
  readonly query: Readonly<Record<string, string>>;
  /** Lower-cased header names (as Node delivers them). Optional; absent = none. */
  readonly headers?: Readonly<Record<string, string>>;
  readonly body: string;
  readonly contentType?: string;
}

export interface HttpResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

const HTML_TYPE = 'text/html; charset=utf-8';
const JSON_TYPE = 'application/json; charset=utf-8';

export function html(status: number, body: string): HttpResponse {
  return { status, headers: { 'content-type': HTML_TYPE }, body };
}

export function json(status: number, value: unknown): HttpResponse {
  return { status, headers: { 'content-type': JSON_TYPE }, body: JSON.stringify(value) };
}
