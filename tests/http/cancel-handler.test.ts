// Phase F — the cancel HTTP handler (DECISIONS_PHASE_F_G.md F1).
//
// The cancel surface is the product's highest-SLO surface (DECISIONS.md 6.1,
// UX_SPEC.md §2). The handler is a PURE function over a parsed request so it can
// be pinned exhaustively without a socket. What these tests lock down:
//   - GET renders / POST cancels — GET is side-effect free (F1.1);
//   - a bad, missing, or forged token never dead-ends: the fallback page with
//     the support path + in-app cancel always renders (F1.2, invariant 1);
//   - a store failure still degrades to the fallback, never a naked 500 (F1.2);
//   - the page carries nothing sensitive — no content, code, or recipient (UX §2).

import type { AuditSink } from '../../src/domain/audit';
import { Machine } from '../../src/domain/machine';
import {
  HashChainedAuditStore,
  InMemoryAppendOnlySink,
  InMemoryKeyValueStore,
  MachineRepository,
} from '../../src/persistence';
import { CancelService } from '../../src/app';
import { handleCancel, type CancelFallback, type HttpRequest } from '../../src/http';
import { T0, daysAfter, machineIn } from '../support/factory';

const SECRET = 'test-cancel-secret';
const FALLBACK: CancelFallback = {
  supportUrl: 'https://legacyvault.example/support',
  inAppCancelUrl: 'https://app.legacyvault.example/cancel',
};

function harness() {
  const machines = new MachineRepository(new InMemoryKeyValueStore());
  const service = new CancelService({
    machines,
    auditFor: () => new HashChainedAuditStore(new InMemoryAppendOnlySink()) as AuditSink,
    secret: SECRET,
  });
  machines.save('acct-1', Machine.restore(machineIn('HOLD')));
  const token = service.issueToken('acct-1', T0);
  const deps = { service, fallback: FALLBACK, now: () => daysAfter(T0, 40) };
  return { machines, service, token, deps };
}

function get(query: Record<string, string>): HttpRequest {
  return { method: 'GET', path: '/cancel', query, body: '' };
}
function post(body: string, contentType = 'application/x-www-form-urlencoded'): HttpRequest {
  return { method: 'POST', path: '/cancel', query: {}, body, contentType };
}

describe('handleCancel — GET renders, never mutates (F1.1)', () => {
  it('renders a confirm page with a POST form for a valid token', () => {
    const { token, deps } = harness();
    const res = handleCancel(get({ t: token }), deps);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.body.toLowerCase()).toContain('<form');
    expect(res.body.toLowerCase()).toContain('method="post"');
    // one-action copy from UX §2
    expect(res.body.toLowerCase()).toContain('stop everything');
  });

  it('does NOT change state — a GET (prefetch/scanner) must never fire a cancel', () => {
    const { token, deps, machines } = harness();
    handleCancel(get({ t: token }), deps);
    expect(machines.getContext('acct-1')!.state).toBe('HOLD');
  });

  it('a missing token renders the fail-safe page, not a dead-end (F1.2)', () => {
    const { deps } = harness();
    const res = handleCancel(get({}), deps);
    expect(res.status).toBe(200);
    expect(res.body).toContain(FALLBACK.supportUrl);
    expect(res.body).toContain(FALLBACK.inAppCancelUrl);
  });

  it('a forged token renders the fail-safe page (F1.2)', () => {
    const { token, deps } = harness();
    const res = handleCancel(get({ t: token + 'tamper' }), deps);
    expect(res.status).toBe(200);
    expect(res.body).toContain(FALLBACK.supportUrl);
  });
});

describe('handleCancel — POST cancels (F1)', () => {
  it('cancels on a valid token and renders the reassuring success page', () => {
    const { token, deps, machines } = harness();
    const res = handleCancel(post(`t=${encodeURIComponent(token)}`), deps);
    expect(res.status).toBe(200);
    expect(machines.getContext('acct-1')!.state).toBe('CANCELLED');
    expect(res.body.toLowerCase()).toContain('everything is stopped');
  });

  it('accepts a JSON body as well as a form body', () => {
    const { token, deps, machines } = harness();
    const res = handleCancel(post(JSON.stringify({ t: token }), 'application/json'), deps);
    expect(res.status).toBe(200);
    expect(machines.getContext('acct-1')!.state).toBe('CANCELLED');
  });

  it('is idempotent — a second POST is still a success page (F1.3)', () => {
    const { token, deps } = harness();
    handleCancel(post(`t=${encodeURIComponent(token)}`), deps);
    const res = handleCancel(post(`t=${encodeURIComponent(token)}`), deps);
    expect(res.status).toBe(200);
    expect(res.body.toLowerCase()).toContain('everything is stopped');
  });

  it('a forged token POST renders the fail-safe page and changes nothing (F1.2)', () => {
    const { token, deps, machines } = harness();
    const res = handleCancel(post(`t=${encodeURIComponent(token + 'x')}`), deps);
    expect(res.body).toContain(FALLBACK.supportUrl);
    expect(machines.getContext('acct-1')!.state).toBe('HOLD');
  });
});

describe('handleCancel — fails safe under failure (F1.2, F5)', () => {
  it('degrades to the fallback page (not a naked 500) when the store throws', () => {
    // A service whose machine store is unreachable: redeem/preview throw.
    const brokenMachines = {
      load: () => {
        throw new Error('state store unreachable');
      },
      getContext: () => {
        throw new Error('state store unreachable');
      },
      save: () => {
        throw new Error('state store unreachable');
      },
      ids: () => [],
    } as unknown as MachineRepository;
    const service = new CancelService({
      machines: brokenMachines,
      auditFor: () => new HashChainedAuditStore(new InMemoryAppendOnlySink()) as AuditSink,
      secret: SECRET,
    });
    const token = service.issueToken('acct-1', T0);
    const deps = { service, fallback: FALLBACK, now: () => daysAfter(T0, 40) };

    const res = handleCancel(post(`t=${encodeURIComponent(token)}`), deps);
    expect(res.status).toBeLessThan(500);
    expect(res.body).toContain(FALLBACK.supportUrl);
  });

  it('an unsupported method does not dead-end either', () => {
    const { deps } = harness();
    const res = handleCancel({ method: 'DELETE', path: '/cancel', query: {}, body: '' }, deps);
    expect(res.body).toContain(FALLBACK.supportUrl);
  });
});

describe('handleCancel — nothing sensitive on the page (UX §2, invariant 6)', () => {
  it('never renders the account id or any content/code', () => {
    const { token, deps } = harness();
    const confirm = handleCancel(get({ t: token }), deps);
    const success = handleCancel(post(`t=${encodeURIComponent(token)}`), deps);
    for (const body of [confirm.body, success.body]) {
      expect(body).not.toContain('acct-1');
    }
  });
});
