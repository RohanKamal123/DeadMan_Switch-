import { randomBytes } from 'node:crypto';
import { buildServices, webRoute, type AppConfig } from '../../src/composition';
import {
  InMemoryEmailAdapter,
  InMemorySmsAdapter,
  InMemoryPushAdapter,
  InMemoryStorageAdapter,
  InMemoryPublicPublisher,
} from '../../src/adapters/channels';
import { InMemoryKeyValueStore, HashChainedAuditStore, InMemoryAppendOnlySink } from '../../src/persistence';
import type { AuditSink } from '../../src/domain/audit';
import type { AuditSinkFactory } from '../../src/runtime';
import type { ContentPolicy } from '../../src/domain/payload';
import { csrfToken, type HttpRequest, type HttpResponse } from '../../src/http';

const POLICY: ContentPolicy = {
  maxBytesByKind: { note: 10_000, photo: 5_000_000, pdf: 10_000_000 },
  allowedMimeTypes: { note: ['text/plain'], photo: ['image/jpeg'], pdf: ['application/pdf'] },
};

function makeRoute() {
  const state = new InMemoryKeyValueStore();
  const stores = new Map<string, AuditSink>();
  const auditFor: AuditSinkFactory = (id) => {
    let s = stores.get(id);
    if (s === undefined) { s = new HashChainedAuditStore(new InMemoryAppendOnlySink()) as AuditSink; stores.set(id, s); }
    return s;
  };
  const config: AppConfig = {
    state,
    cursors: new InMemoryKeyValueStore(),
    credentials: new InMemoryKeyValueStore(),
    auditFor,
    secrets: { cancelTokenSecrets: ['c'], sessionSecret: 's', kmsMasterKey: randomBytes(32) },
    channels: { email: new InMemoryEmailAdapter(), sms: new InMemorySmsAdapter(), push: new InMemoryPushAdapter(), storage: new InMemoryStorageAdapter() },
    publisher: new InMemoryPublicPublisher(),
    contentPolicy: POLICY,
    sessionTtlMs: 3_600_000,
    opsEmail: 'o@t.test',
    gatedBaseUrl: 'https://app.test/release',
    cancelFallback: { supportUrl: 'https://s.test' },
    baseUrl: 'https://app.test',
    secureCookies: false,
    now: () => 1000,
  };
  const services = buildServices(config);
  return webRoute(services, config);
}

const route = makeRoute();

function req(method: string, path: string, opts: { body?: string; cookie?: string } = {}): Promise<HttpResponse> {
  const headers: Record<string, string> = { 'content-type': 'application/x-www-form-urlencoded' };
  if (opts.cookie !== undefined) headers['cookie'] = opts.cookie;
  const r: HttpRequest = { method, path, query: {}, headers, body: opts.body ?? '' };
  return Promise.resolve(route(r));
}

describe('site handler — public surfaces', () => {
  it.each(['/', '/how-it-works', '/who-its-for', '/pricing', '/security', '/legal/terms', '/legal/privacy', '/legal/estate', '/legal/cookies', '/signup'])(
    'serves %s as a titled HTML page',
    async (path) => {
      const res = await req('GET', path);
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/html');
      expect(res.body).toContain('<title>');
      expect(res.body).toContain('Legacy Vault');
    },
  );

  it('shows all three plans on the pricing page', async () => {
    const res = await req('GET', '/pricing');
    expect(res.body).toContain('Keepsake');
    expect(res.body).toContain('Legacy');
    expect(res.body).toContain('Estate');
  });
});

describe('site handler — user app', () => {
  it('signs up, sets a session cookie, and renders the home check-in', async () => {
    const signup = await req('POST', '/app/signup', { body: 'email=a@b.com&password=abcdefgh&evidence=lenient&agree=on' });
    expect(signup.status).toBe(303);
    const setCookie = String(signup.headers['set-cookie'] ?? '');
    expect(setCookie).toContain('lv_session=');
    const cookie = setCookie.split(';')[0];

    const home = await req('GET', '/app', { cookie });
    expect(home.status).toBe(200);
    expect(home.body).toContain('I’m alive');
    expect(home.body).toContain('All good');
  });

  it('rejects a signup that did not accept the terms', async () => {
    const res = await req('POST', '/app/signup', { body: 'email=c@d.com&password=abcdefgh&evidence=lenient' });
    expect(res.status).toBe(400);
  });

  it('a signed-out /app renders the sign-in page, not the home', async () => {
    const res = await req('GET', '/app');
    expect(res.status).toBe(200);
    expect(res.body).toContain('Sign in');
  });

  it('a check-in POST without a valid CSRF token does not error and redirects', async () => {
    const signup = await req('POST', '/app/signup', { body: 'email=e@f.com&password=abcdefgh&evidence=lenient&agree=on' });
    const cookie = String(signup.headers['set-cookie']).split(';')[0];
    const token = cookie.split('=')[1];

    const noCsrf = await req('POST', '/app/check-in', { cookie, body: 'csrf=wrong' });
    expect(noCsrf.status).toBe(303);

    const withCsrf = await req('POST', '/app/check-in', { cookie, body: `csrf=${encodeURIComponent(csrfToken(decodeURIComponent(token)))}` });
    expect(withCsrf.status).toBe(303);
    expect(withCsrf.headers['location']).toBe('/app');
  });
});

describe('site handler — operator and memorial', () => {
  it('gates the operator console behind an operator sign-in', async () => {
    const res = await req('GET', '/console');
    expect(res.status).toBe(200);
    expect(res.body).toContain('Operator sign in');
  });

  it('returns a not-found memorial page for an unknown handle', async () => {
    const res = await req('GET', '/memorial/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body).toContain('isn’t here');
  });
});

describe('site handler — JSON API still reachable underneath', () => {
  it('falls through to the JSON API for a non-HTML path', async () => {
    const res = await req('POST', '/check-in', { body: '{}' });
    expect(res.status).toBe(401); // unauthenticated JSON check-in
    expect(res.headers['content-type']).toContain('application/json');
  });
});
