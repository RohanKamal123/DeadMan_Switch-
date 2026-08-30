// Phase G — the login endpoint (DECISIONS_PHASE_F_G.md G3).

import { handleLogin, type HttpRequest, type LoginBackend } from '../../src/http';

const backend: LoginBackend = {
  login: (identifier, password) =>
    identifier === 'u@x.test' && password === 'pw'
      ? { ok: true, token: 'session-token' }
      : { ok: false, reason: 'invalid credentials' },
};
const deps = { auth: backend, now: () => 0 };

function post(body: unknown): HttpRequest {
  return { method: 'POST', path: '/auth/login', query: {}, body: JSON.stringify(body), contentType: 'application/json' };
}

describe('handleLogin', () => {
  it('returns a token on a correct login', () => {
    const res = handleLogin(post({ identifier: 'u@x.test', password: 'pw' }), deps);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body).token).toBe('session-token');
  });
  it('returns a flat 401 on a bad login (no detail on which half was wrong)', () => {
    const res = handleLogin(post({ identifier: 'u@x.test', password: 'nope' }), deps);
    expect(res.status).toBe(401);
    expect(res.body).not.toContain('password');
  });
  it('400s a malformed body', () => {
    expect(handleLogin(post({ identifier: 'u@x.test' }), deps).status).toBe(400);
  });
});
