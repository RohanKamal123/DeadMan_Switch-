// Phase G — the auth service (DECISIONS_PHASE_F_G.md G3; DECISIONS.md 8.2).
//
// Ties the credential store to session issuance and audited recovery:
//   - login: verify a password, issue a stateless signed session token.
//   - enroll: create a credential (user / operator / admin).
//   - adminRecover: the ONLY reset path (8.2) — an admin, having verified
//     identity manually and offline, sets a new credential. It is audited on the
//     account's immutable trail (invariant 7). There is deliberately NO
//     self-serve reset: no automated path an attacker could use to seize an
//     account and force a release.

import type { PrincipalKind } from '../../app/principal';
import type { AuditSinkFactory } from '../../runtime';
import type { CredentialStore } from './credentials';
import { issueSession } from './session';

export interface AuthServiceOptions {
  readonly credentials: CredentialStore;
  readonly sessionSecret: string;
  readonly sessionTtlMs: number;
  /** Per-account audit sink, so a manual recovery is logged (invariant 7). */
  readonly auditFor: AuditSinkFactory;
}

export type LoginResult =
  | { readonly ok: true; readonly token: string }
  | { readonly ok: false; readonly reason: string };

export class AuthService {
  private readonly credentials: CredentialStore;
  private readonly sessionSecret: string;
  private readonly sessionTtlMs: number;
  private readonly auditFor: AuditSinkFactory;

  constructor(options: AuthServiceOptions) {
    this.credentials = options.credentials;
    this.sessionSecret = options.sessionSecret;
    this.sessionTtlMs = options.sessionTtlMs;
    this.auditFor = options.auditFor;
  }

  login(identifier: string, password: string, at: number): LoginResult {
    const principal = this.credentials.verify(identifier, password);
    if (principal === null) return { ok: false, reason: 'invalid credentials' };
    return { ok: true, token: issueSession(principal, at, { secret: this.sessionSecret, ttlMs: this.sessionTtlMs }) };
  }

  enroll(params: {
    identifier: string;
    kind: PrincipalKind;
    principalId: string;
    accountId?: string;
    password: string;
  }): { ok: boolean; reason?: string } {
    if (this.credentials.has(params.identifier)) {
      return { ok: false, reason: 'identifier already enrolled' };
    }
    this.credentials.set(params);
    return { ok: true };
  }

  /**
   * Manual, admin-driven credential reset (8.2). Identity is verified offline by
   * the admin; this only writes the new credential and audits it on the user's
   * account trail. Slow by design; there is no code path that shortcuts it.
   */
  adminRecover(params: {
    adminId: string;
    identifier: string;
    kind: PrincipalKind;
    principalId: string;
    accountId: string;
    newPassword: string;
    at: number;
  }): { ok: boolean } {
    this.credentials.set({
      identifier: params.identifier,
      kind: params.kind,
      principalId: params.principalId,
      accountId: params.accountId,
      password: params.newPassword,
    });
    this.auditFor(params.accountId).append({
      at: params.at,
      kind: 'CONTEXT',
      event: 'ADMIN_RECOVER_CREDENTIAL',
      actor: params.adminId,
      metadata: {},
    });
    return { ok: true };
  }
}
