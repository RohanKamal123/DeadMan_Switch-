// Phase H — public-release publishing (PRODUCT_SPEC.md §PUBLIC_RELEASE).
//
// Public release happens only if the user explicitly enabled it, and only 14
// days after PRIVATE_RELEASE — that gap is a final chance to catch a wrong
// release before it is on the open internet. The machine enforces the gap and
// the enabled flag (TRIGGER_PUBLIC_RELEASE guard); this service performs the
// actual publish ONCE the machine is already in PUBLIC_RELEASE, through a
// `PublicPublisher` port whose concrete destination is a deployment concern. It
// never advances the machine and logs the publish as metadata only (invariant 7).

import type { PublicPublisher } from '../adapters/channels/ports';
import type { MachineRepository } from '../persistence';
import type { AuditSinkFactory } from '../runtime';

export interface PublicReleaseServiceOptions {
  readonly machines: MachineRepository;
  readonly publisher: PublicPublisher;
  readonly auditFor: AuditSinkFactory;
}

export type PublicReleaseResult = { readonly ok: true } | { readonly ok: false; readonly reason: string };

export class PublicReleaseService {
  private readonly machines: MachineRepository;
  private readonly publisher: PublicPublisher;
  private readonly auditFor: AuditSinkFactory;

  constructor(options: PublicReleaseServiceOptions) {
    this.machines = options.machines;
    this.publisher = options.publisher;
    this.auditFor = options.auditFor;
  }

  /** Publish public content. Refuses unless the machine is already in PUBLIC_RELEASE. */
  publish(accountId: string, at: number): PublicReleaseResult {
    const ctx = this.machines.getContext(accountId);
    if (ctx === undefined) return { ok: false, reason: 'account not found' };
    if (ctx.state !== 'PUBLIC_RELEASE') {
      return { ok: false, reason: `public publish requires PUBLIC_RELEASE, not ${ctx.state}` };
    }
    this.publisher.publish(accountId, at);
    this.auditFor(accountId).append({
      at,
      kind: 'OUTREACH',
      event: 'PUBLIC_PUBLISH',
      metadata: {},
    });
    return { ok: true };
  }
}
