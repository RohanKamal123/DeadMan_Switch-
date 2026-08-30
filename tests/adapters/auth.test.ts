// Phase G — auth: passwords, credential store, sessions, AuthService (G3),
// and secrets loading (G4).

import type { AuditSink } from '../../src/domain/audit';
import {
  HashChainedAuditStore,
  InMemoryAppendOnlySink,
  InMemoryKeyValueStore,
} from '../../src/persistence';
import {
  AuthService,
  CredentialStore,
  SessionAuthenticator,
  hashPassword,
  issueSession,
  secretsFromEnv,
  verifyPassword,
  MissingSecretError,
} from '../../src/adapters';
import type { AuditSinkFactory } from '../../src/runtime';

describe('password hashing', () => {
  it('verifies a correct password and rejects a wrong one', () => {
    const hash = hashPassword('correct horse');
    expect(verifyPassword('correct horse', hash)).toBe(true);
    expect(verifyPassword('wrong', hash)).toBe(false);
  });
});

describe('CredentialStore', () => {
  it('verifies a stored credential to a principal, never storing plaintext', () => {
    const store = new InMemoryKeyValueStore();
    const creds = new CredentialStore(store);
    creds.set({ identifier: 'user@x.test', kind: 'user', principalId: 'u1', accountId: 'a1', password: 's3cret' });
    expect(creds.verify('user@x.test', 's3cret')).toEqual({ kind: 'user', id: 'u1', accountId: 'a1' });
    expect(creds.verify('user@x.test', 'nope')).toBeNull();
    // No plaintext password anywhere in the backing store.
    expect(store.keys().map((k) => store.get(k)).join()).not.toContain('s3cret');
  });
});

describe('sessions', () => {
  const secret = 'session-secret';
  it('authenticates a valid, unexpired session token', () => {
    const token = issueSession({ kind: 'operator', id: 'op1' }, 1000, { secret, ttlMs: 10_000 });
    const auth = new SessionAuthenticator({ secret, now: () => 5000 });
    expect(auth.authenticate(token)).toEqual({ kind: 'operator', id: 'op1' });
  });
  it('rejects an expired token and a wrong-secret token', () => {
    const token = issueSession({ kind: 'user', id: 'u1', accountId: 'a1' }, 1000, { secret, ttlMs: 10_000 });
    expect(new SessionAuthenticator({ secret, now: () => 99_999 }).authenticate(token)).toBeNull();
    expect(new SessionAuthenticator({ secret: 'other', now: () => 5000 }).authenticate(token)).toBeNull();
  });
});

describe('AuthService', () => {
  function harness() {
    const kv = new InMemoryKeyValueStore();
    const credentials = new CredentialStore(kv);
    const stores = new Map<string, HashChainedAuditStore>();
    const storeFor = (id: string): HashChainedAuditStore => {
      let s = stores.get(id);
      if (s === undefined) {
        s = new HashChainedAuditStore(new InMemoryAppendOnlySink());
        stores.set(id, s);
      }
      return s;
    };
    const auditFor: AuditSinkFactory = (id) => storeFor(id) as AuditSink;
    const auth = new AuthService({ credentials, sessionSecret: 'sess', sessionTtlMs: 10_000, auditFor });
    return { auth, credentials, storeFor };
  }

  it('logs a user in and issues a working session token', () => {
    const h = harness();
    h.auth.enroll({ identifier: 'u@x.test', kind: 'user', principalId: 'u1', accountId: 'a1', password: 'pw' });
    const login = h.auth.login('u@x.test', 'pw', 1000);
    expect(login.ok).toBe(true);
    if (login.ok) {
      const principal = new SessionAuthenticator({ secret: 'sess', now: () => 2000 }).authenticate(login.token);
      expect(principal).toEqual({ kind: 'user', id: 'u1', accountId: 'a1' });
    }
  });

  it('rejects a bad login', () => {
    const h = harness();
    h.auth.enroll({ identifier: 'u@x.test', kind: 'user', principalId: 'u1', accountId: 'a1', password: 'pw' });
    expect(h.auth.login('u@x.test', 'WRONG', 1000).ok).toBe(false);
  });

  it('has no self-serve reset; admin recovery resets the credential and is audited (8.2)', () => {
    const h = harness();
    h.auth.enroll({ identifier: 'u@x.test', kind: 'user', principalId: 'u1', accountId: 'a1', password: 'old' });
    h.auth.adminRecover({ adminId: 'ad1', identifier: 'u@x.test', kind: 'user', principalId: 'u1', accountId: 'a1', newPassword: 'new', at: 5 });
    expect(h.auth.login('u@x.test', 'old', 10).ok).toBe(false);
    expect(h.auth.login('u@x.test', 'new', 10).ok).toBe(true);
    const events = h.storeFor('a1').all();
    expect(events.map((e) => e.event)).toContain('ADMIN_RECOVER_CREDENTIAL');
    expect(events.find((e) => e.event === 'ADMIN_RECOVER_CREDENTIAL')!.actor).toBe('ad1');
  });
});

describe('secretsFromEnv (G4)', () => {
  it('loads secrets from the environment and splits previous cancel secrets', () => {
    const secrets = secretsFromEnv({
      LV_CANCEL_SECRET: 'current',
      LV_CANCEL_SECRET_PREVIOUS: 'old1, old2',
      LV_SESSION_SECRET: 'sess',
      LV_KMS_MASTER_KEY: 'a'.repeat(64),
    } as NodeJS.ProcessEnv);
    expect(secrets.cancelTokenSecrets).toEqual(['current', 'old1', 'old2']);
    expect(secrets.kmsKeyRing).toHaveLength(1);
    expect(secrets.kmsKeyRing[0]).toHaveLength(32);
  });
  it('loads a KMS key ring with previous keys for rotation (current first)', () => {
    const secrets = secretsFromEnv({
      LV_CANCEL_SECRET: 'current',
      LV_SESSION_SECRET: 'sess',
      LV_KMS_MASTER_KEY: 'a'.repeat(64),
      LV_KMS_MASTER_KEY_PREVIOUS: `${'b'.repeat(64)}, ${'c'.repeat(64)}`,
    } as NodeJS.ProcessEnv);
    expect(secrets.kmsKeyRing).toHaveLength(3);
    expect(secrets.kmsKeyRing[0]).toEqual(Buffer.alloc(32, 0xaa));
    expect(secrets.kmsKeyRing[1]).toEqual(Buffer.alloc(32, 0xbb));
  });
  it('throws when the KMS master key is not 32 bytes', () => {
    expect(() =>
      secretsFromEnv({
        LV_CANCEL_SECRET: 'c',
        LV_SESSION_SECRET: 's',
        LV_KMS_MASTER_KEY: 'a'.repeat(30),
      } as NodeJS.ProcessEnv),
    ).toThrow(MissingSecretError);
  });
  it('throws when a required secret is missing', () => {
    expect(() => secretsFromEnv({} as NodeJS.ProcessEnv)).toThrow(MissingSecretError);
  });
});
