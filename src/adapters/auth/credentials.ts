// Phase G — the credential store (DECISIONS_PHASE_F_G.md G3).
//
// Persists login credentials (identifier → hashed secret + principal) over a
// KeyValueStore, so credentials survive a restart. It stores ONLY the salt and
// hash, never a plaintext password. `verify` returns the principal on a correct
// password, else null — the caller (AuthService) issues a session from it.
//
// There is deliberately NO self-serve reset here (8.2): a lost credential is
// recovered manually by an admin, audited, via AuthService.

import type { Principal, PrincipalKind } from '../../app/principal';
import type { KeyValueStore } from '../../persistence';
import { hashPassword, verifyPassword, type PasswordHash } from './passwords';

export interface CredentialRecord {
  readonly identifier: string;
  readonly kind: PrincipalKind;
  readonly principalId: string;
  readonly accountId?: string;
  readonly password: PasswordHash;
}

export class CredentialStore {
  constructor(private readonly store: KeyValueStore) {}

  private key(identifier: string): string {
    return `credential:${identifier.toLowerCase()}`;
  }

  has(identifier: string): boolean {
    return this.store.get(this.key(identifier)) !== undefined;
  }

  /** Create or replace a credential. Used at enrollment and by admin recovery. */
  set(params: {
    identifier: string;
    kind: PrincipalKind;
    principalId: string;
    accountId?: string;
    password: string;
  }): void {
    const record: CredentialRecord = {
      identifier: params.identifier,
      kind: params.kind,
      principalId: params.principalId,
      ...(params.accountId !== undefined ? { accountId: params.accountId } : {}),
      password: hashPassword(params.password),
    };
    this.store.set(this.key(params.identifier), JSON.stringify(record));
  }

  private get(identifier: string): CredentialRecord | undefined {
    const raw = this.store.get(this.key(identifier));
    return raw === undefined ? undefined : (JSON.parse(raw) as CredentialRecord);
  }

  /** Verify a password and return the principal it authenticates, or null. */
  verify(identifier: string, password: string): Principal | null {
    const record = this.get(identifier);
    if (record === undefined) return null;
    if (!verifyPassword(password, record.password)) return null;
    return {
      kind: record.kind,
      id: record.principalId,
      ...(record.accountId !== undefined ? { accountId: record.accountId } : {}),
    };
  }
}
