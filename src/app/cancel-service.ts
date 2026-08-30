// Phase F — the cancel application service (DECISIONS_PHASE_F_G.md F0, F1).
//
// The application-service tier is the ONLY tier that mutates. A surface (HTTP)
// never writes state; it calls a method here, and this method advances the
// machine through the guarded `transition` exactly like the scheduler does
// (`machine.apply` → `transition`, no ad-hoc status writes). That keeps every
// invariant where it already lives — in `src/domain/` — and out of the code
// that faces the network.
//
// This is the cancel path, so it is the highest-SLO surface in the product
// (DECISIONS.md 6.1) and the embodiment of invariant 1 (CANCELLED reachable
// from every state, unconditionally). Its design choices:
//   - `preview` verifies a token and mutates NOTHING (a GET must be side-effect
//     free so link prefetchers and mail scanners can never fire a cancel, F1.1);
//   - `redeem` verifies, loads the machine WITH its durable audit sink, applies
//     CANCEL, and persists — the cancellation is durable and logged (invariant 7);
//   - `redeem` is idempotent: CANCEL never rejects in `transition`, so cancelling
//     an already-safe or already-cancelled account is a success, never an error
//     (F1.3). The living user who taps twice sees reassurance, not a scary error.
//   - a bad/forged token changes nothing; a store failure is allowed to throw so
//     the HTTP layer degrades to the fail-safe page (F1.2) rather than pretend a
//     cancel succeeded.

import { issueCancelToken, verifyCancelToken } from '../cancel/token';
import type { MachineRepository } from '../persistence';
import type { AuditSinkFactory } from '../runtime';

export interface CancelServiceOptions {
  readonly machines: MachineRepository;
  /** The durable, per-account audit sink so a cancellation is logged (invariant 7). */
  readonly auditFor: AuditSinkFactory;
  /** The HMAC signing secret for cancel tokens (DECISIONS_PHASE_F_G.md G4). */
  readonly secret: string;
}

export type CancelPreview =
  | { readonly ok: true; readonly accountId: string }
  | { readonly ok: false; readonly reason: string };

export type CancelOutcome =
  | { readonly ok: true; readonly accountId: string }
  | { readonly ok: false; readonly reason: string };

export class CancelService {
  private readonly machines: MachineRepository;
  private readonly auditFor: AuditSinkFactory;
  private readonly secret: string;

  constructor(options: CancelServiceOptions) {
    this.machines = options.machines;
    this.auditFor = options.auditFor;
    this.secret = options.secret;
  }

  /** Issue a signed cancel token for an account (embedded in NUDGE/HOLD outreach). */
  issueToken(accountId: string, at: number): string {
    return issueCancelToken(accountId, at, this.secret);
  }

  /**
   * Validate a token without touching state. Used by the GET confirm page so a
   * prefetch or a mail-scanner fetch can never advance the machine (F1.1).
   */
  preview(token: string, at: number): CancelPreview {
    const verified = verifyCancelToken(token, this.secret, at);
    if (!verified.ok) return { ok: false, reason: verified.reason };
    return { ok: true, accountId: verified.accountId };
  }

  /**
   * Verify the token and cancel the account (invariant 1). Idempotent: a repeat
   * cancel is a success (F1.3). A bad token or an unknown account changes
   * nothing. A store failure is intentionally NOT swallowed here — it propagates
   * so the caller renders the fail-safe page instead of a false "done".
   */
  redeem(token: string, at: number): CancelOutcome {
    const verified = verifyCancelToken(token, this.secret, at);
    if (!verified.ok) return { ok: false, reason: verified.reason };

    const machine = this.machines.load(verified.accountId, this.auditFor(verified.accountId));
    if (machine === undefined) {
      // A valid token for an account with no persisted machine: never fabricate
      // a state. Fail safe — the fallback page still gives the user a way out.
      return { ok: false, reason: 'account not found' };
    }

    const result = machine.apply({ type: 'CANCEL', at, source: 'cancel-link' });
    if (!result.ok) {
      // CANCEL is unconditional in `transition`, so this is unreachable in
      // practice; kept as a defensive branch that never claims a false success.
      return { ok: false, reason: result.reason };
    }
    this.machines.save(verified.accountId, machine);
    return { ok: true, accountId: verified.accountId };
  }
}
