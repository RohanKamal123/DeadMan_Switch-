// provisionOperator (src/cli/create-operator.ts) — the testable core behind the
// operator-provisioning CLI. There is no self-serve way to become an operator
// (mirrors 8.2), so this is the only path; it must both create a fresh operator
// AND genuinely reset an existing one's password (a real bug caught during
// manual testing: AuthService.enroll() refuses an already-enrolled identifier
// rather than overwriting it).

import { randomBytes } from 'crypto';
import { AuthService, CredentialStore } from '../../src/adapters/auth';
import { InMemoryKeyValueStore, HashChainedAuditStore, InMemoryAppendOnlySink } from '../../src/persistence';
import type { AuditSink } from '../../src/domain/audit';
import type { AuditSinkFactory } from '../../src/runtime';
import { provisionOperator, randomPassword } from '../../src/cli/create-operator';

function harness() {
  const credentials = new InMemoryKeyValueStore();
  const auditFor: AuditSinkFactory = () => new HashChainedAuditStore(new InMemoryAppendOnlySink()) as AuditSink;
  const auth = new AuthService({ credentials: new CredentialStore(credentials), sessionSecret: randomBytes(16).toString('hex'), sessionTtlMs: 3_600_000, auditFor });
  return { auth, credentials };
}

describe('provisionOperator', () => {
  it('creates a new operator credential that can then log in', () => {
    const { auth, credentials } = harness();
    const result = provisionOperator(auth, credentials, { identifier: 'ops@x.test', password: 'first-password' });
    expect(result).toEqual({ ok: true, created: true });

    const login = auth.login('ops@x.test', 'first-password', Date.now());
    expect(login.ok).toBe(true);
  });

  it('the created principal is kind "operator"', () => {
    const { auth, credentials } = harness();
    provisionOperator(auth, credentials, { identifier: 'ops@x.test', password: 'pw' });
    const principal = new CredentialStore(credentials).verify('ops@x.test', 'pw');
    expect(principal?.kind).toBe('operator');
  });

  it('re-running with the same identifier RESETS the password rather than failing (the bug caught in manual testing)', () => {
    const { auth, credentials } = harness();
    provisionOperator(auth, credentials, { identifier: 'ops@x.test', password: 'old-password' });

    const result = provisionOperator(auth, credentials, { identifier: 'ops@x.test', password: 'new-password' });
    expect(result).toEqual({ ok: true, created: false });

    expect(auth.login('ops@x.test', 'old-password', Date.now()).ok).toBe(false);
    expect(auth.login('ops@x.test', 'new-password', Date.now()).ok).toBe(true);
  });

  it('a genuinely different enroll failure is reported, not papered over as a reset', () => {
    const { credentials } = harness();
    const authThatAlwaysRejects = {
      enroll: () => ({ ok: false, reason: 'some other validation failure' }),
    } as unknown as AuthService;
    const result = provisionOperator(authThatAlwaysRejects, credentials, { identifier: 'ops@x.test', password: 'pw' });
    expect(result).toEqual({ ok: false, reason: 'some other validation failure' });
  });
});

describe('randomPassword', () => {
  it('generates a reasonably long, distinct password each call', () => {
    const a = randomPassword();
    const b = randomPassword();
    expect(a.length).toBeGreaterThanOrEqual(20);
    expect(a).not.toBe(b);
  });
});
