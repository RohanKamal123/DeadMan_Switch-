// Phase F — the authenticated principal (DECISIONS_PHASE_F_G.md F3).
//
// The identity an app service acts on behalf of, so every mutation can be
// attributed in the audit trail (invariant 7). The three audiences that
// authenticate: the account owner ('user'), the operator team ('operator'), and
// admins ('admin'). The no-login cancel link and the capability-token recipient
// page are the two deliberate exceptions that carry no principal.

export type PrincipalKind = 'user' | 'operator' | 'admin';

export interface Principal {
  readonly kind: PrincipalKind;
  /** The stable id recorded in the audit trail (operator/admin/user id). */
  readonly id: string;
  /** For a 'user' principal, the account they own; absent for operator/admin. */
  readonly accountId?: string;
}
