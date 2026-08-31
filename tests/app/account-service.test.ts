import { AccountService } from '../../src/app';
import { AccountRepository, MachineRepository, InMemoryKeyValueStore, HashChainedAuditStore, InMemoryAppendOnlySink } from '../../src/persistence';
import type { AuditSink } from '../../src/domain/audit';
import type { AuditSinkFactory } from '../../src/runtime';

function fakeAuth() {
  const identifiers = new Set<string>();
  return {
    identifiers,
    enroll(p: { identifier: string }) {
      if (identifiers.has(p.identifier)) return { ok: false, reason: 'identifier already enrolled' };
      identifiers.add(p.identifier);
      return { ok: true };
    },
    login(identifier: string) {
      return identifiers.has(identifier) ? { ok: true as const, token: `tok:${identifier}` } : { ok: false as const, reason: 'no' };
    },
  };
}

function build() {
  const store = new InMemoryKeyValueStore();
  const accounts = new AccountRepository(store);
  const machines = new MachineRepository(store);
  const auditFor: AuditSinkFactory = () => new HashChainedAuditStore(new InMemoryAppendOnlySink()) as AuditSink;
  const auth = fakeAuth();
  let n = 0;
  const service = new AccountService({ accounts, machines, auth, auditFor, newAccountId: () => `acct_${++n}` });
  return { service, accounts, machines, auth };
}

describe('AccountService.signup', () => {
  it('creates an account resting in ACTIVE with the chosen configuration', () => {
    const { service, accounts, machines } = build();
    const result = service.signup({ email: 'A@Example.com', password: 'abcdefgh', evidenceMode: 'strict', publicReleaseEnabled: true }, 1000);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(machines.getContext(result.accountId)!.state).toBe('ACTIVE');
    expect(machines.getContext(result.accountId)!.evidenceMode).toBe('strict');
    expect(machines.getContext(result.accountId)!.publicReleaseEnabled).toBe(true);
    expect(accounts.get(result.accountId)!.evidenceMode).toBe('strict');
    expect(result.token).toContain('a@example.com');
  });

  it('rejects a weak password and a bad email', () => {
    const { service } = build();
    expect(service.signup({ email: 'x', password: 'abcdefgh', evidenceMode: 'lenient', publicReleaseEnabled: false }, 0).ok).toBe(false);
    expect(service.signup({ email: 'x@y.com', password: 'short', evidenceMode: 'lenient', publicReleaseEnabled: false }, 0).ok).toBe(false);
  });

  it('refuses a duplicate email', () => {
    const { service } = build();
    service.signup({ email: 'dup@y.com', password: 'abcdefgh', evidenceMode: 'lenient', publicReleaseEnabled: false }, 0);
    const again = service.signup({ email: 'dup@y.com', password: 'abcdefgh', evidenceMode: 'lenient', publicReleaseEnabled: false }, 0);
    expect(again.ok).toBe(false);
  });
});
