// Account onboarding (UX_SPEC.md §1.1). The app tier that CREATES an account:
// it enrolls a login credential, seeds a fresh machine resting in ACTIVE with
// the two deliberate choices onboarding forces — evidence mode and whether
// public release is enabled — and writes the account record. Like every app
// service it is the only tier that mutates, and it never advances the machine
// toward release: a new account starts, and can only start, in ACTIVE.
//
// Evidence mode and public release are fixed at creation and shown thereafter in
// settings; changing them is a manual, audited support action, not a toggle —
// consistent with the conservative posture (they shape the death path, so they
// do not move on a careless tap). Reintroducing an in-app change later would go
// through a guarded transition, never an ad-hoc context write.

import { Machine } from '../domain/machine';
import type { EvidenceMode } from '../domain/states';
import { AccountRepository, type MachineRepository } from '../persistence';
import type { AuditSinkFactory } from '../runtime';

export interface AuthEnroller {
  enroll(params: {
    identifier: string;
    kind: 'user';
    principalId: string;
    accountId: string;
    password: string;
  }): { ok: boolean; reason?: string };
  login(identifier: string, password: string, at: number): { ok: true; token: string } | { ok: false; reason: string };
}

export interface AccountServiceOptions {
  readonly accounts: AccountRepository;
  readonly machines: MachineRepository;
  readonly auth: AuthEnroller;
  readonly auditFor: AuditSinkFactory;
  /** Generates a fresh account id (injected so tests are deterministic). */
  readonly newAccountId: () => string;
}

export interface SignupInput {
  readonly email: string;
  readonly password: string;
  readonly evidenceMode: EvidenceMode;
  readonly publicReleaseEnabled: boolean;
}

export type SignupResult =
  | { readonly ok: true; readonly accountId: string; readonly token: string }
  | { readonly ok: false; readonly reason: string };

export class AccountService {
  private readonly accounts: AccountRepository;
  private readonly machines: MachineRepository;
  private readonly auth: AuthEnroller;
  private readonly auditFor: AuditSinkFactory;
  private readonly newAccountId: () => string;

  constructor(options: AccountServiceOptions) {
    this.accounts = options.accounts;
    this.machines = options.machines;
    this.auth = options.auth;
    this.auditFor = options.auditFor;
    this.newAccountId = options.newAccountId;
  }

  signup(input: SignupInput, at: number): SignupResult {
    const email = input.email.trim().toLowerCase();
    if (email === '' || !email.includes('@')) return { ok: false, reason: 'a valid email is required' };
    if (input.password.length < 8) return { ok: false, reason: 'password must be at least 8 characters' };

    const accountId = this.newAccountId();
    const enrolled = this.auth.enroll({ identifier: email, kind: 'user', principalId: accountId, accountId, password: input.password });
    if (!enrolled.ok) return { ok: false, reason: enrolled.reason ?? 'could not create account' };

    // Seed a fresh machine in ACTIVE with the chosen configuration, then persist.
    const machine = new Machine({
      now: at,
      evidenceMode: input.evidenceMode,
      publicReleaseEnabled: input.publicReleaseEnabled,
      audit: this.auditFor(accountId),
    });
    this.machines.save(accountId, machine);
    this.accounts.save(accountId, {
      id: accountId,
      createdAt: at,
      evidenceMode: input.evidenceMode,
      publicReleaseEnabled: input.publicReleaseEnabled,
      softDeletedAt: null,
    });
    this.auditFor(accountId).append({
      at,
      kind: 'CONTEXT',
      event: 'ACCOUNT_CREATED',
      metadata: { evidenceMode: input.evidenceMode, publicReleaseEnabled: input.publicReleaseEnabled },
    });

    const login = this.auth.login(email, input.password, at);
    if (!login.ok) return { ok: false, reason: 'account created but sign-in failed; please sign in' };
    return { ok: true, accountId, token: login.token };
  }

  get(accountId: string): ReturnType<AccountRepository['get']> {
    return this.accounts.get(accountId);
  }
}
