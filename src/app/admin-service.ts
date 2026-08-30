// Phase F — the admin application service (DECISIONS_PHASE_F_G.md F2; veto path
// 4). Admin freeze/unfreeze and release-access revocation.
//
// Freeze is a fail-SAFE action (toward delay): a frozen account cannot enter
// VERIFYING or start a HOLD (the guards live in `transition`), so it needs no
// HOLD-style window. Every action is attributed to the admin and audited
// (invariant 7). This service adds no logic of its own — freeze/unfreeze go
// through the guarded transition, revoke through the release engine.

import type { MachineRepository } from '../persistence';
import type { AuditSinkFactory } from '../runtime';
import type { ReleaseService } from './release-service';

export interface AdminServiceOptions {
  readonly machines: MachineRepository;
  readonly auditFor: AuditSinkFactory;
  readonly release: ReleaseService;
}

export type AdminResult = { readonly ok: true } | { readonly ok: false; readonly reason: string };

export class AdminService {
  private readonly machines: MachineRepository;
  private readonly auditFor: AuditSinkFactory;
  private readonly release: ReleaseService;

  constructor(options: AdminServiceOptions) {
    this.machines = options.machines;
    this.auditFor = options.auditFor;
    this.release = options.release;
  }

  private applyFreeze(accountId: string, event: { type: 'ADMIN_FREEZE' | 'ADMIN_UNFREEZE'; at: number; adminId: string }): AdminResult {
    const machine = this.machines.load(accountId, this.auditFor(accountId));
    if (machine === undefined) return { ok: false, reason: 'account not found' };
    const result = machine.apply(event);
    if (!result.ok) return { ok: false, reason: result.reason };
    this.machines.save(accountId, machine);
    return { ok: true };
  }

  /** Admin freeze (fraud report / legal hold). Fail-safe: blocks advancing, never releases. */
  freeze(accountId: string, adminId: string, at: number): AdminResult {
    return this.applyFreeze(accountId, { type: 'ADMIN_FREEZE', at, adminId });
  }

  unfreeze(accountId: string, adminId: string, at: number): AdminResult {
    return this.applyFreeze(accountId, { type: 'ADMIN_UNFREEZE', at, adminId });
  }

  /** Revoke a recipient's release access (§7, UX §3.8). Audited; denies further access. */
  revoke(accountId: string, recipientId: string, adminId: string, at: number): AdminResult {
    const result = this.release.revoke(accountId, recipientId, adminId, at);
    if (result.ok) return { ok: true };
    return { ok: false, reason: result.reason ?? 'revoke failed' };
  }
}
