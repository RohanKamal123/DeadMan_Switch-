// Billing — the stored subscription record and how it maps to entitlements.
//
// The record is the local mirror of what the payment provider believes; the
// provider stays authoritative for money, and this mirror is authoritative for
// what the app lets a user newly set up. Reading entitlements from a lapsed
// subscription drops to the free tier for NEW expansions only (plans.ts) — it
// never reaches into the death path.

import { type Entitlements, type PlanId, entitlementsFor } from './plans';

export type SubscriptionStatus =
  | 'active'
  | 'trialing'
  | 'past_due'
  | 'canceled'
  | 'incomplete';

export interface Subscription {
  readonly accountId: string;
  readonly planId: PlanId;
  readonly status: SubscriptionStatus;
  readonly provider: 'stripe' | 'none';
  /** Provider customer handle (Stripe customer id), once a checkout has run. */
  readonly customerId?: string;
  /** Provider subscription handle. */
  readonly subscriptionId?: string;
  /** Epoch ms the paid period runs to; used for the past-due grace window. */
  readonly currentPeriodEnd?: number;
  readonly updatedAt: number;
}

/** The default record for an account that has never paid: the free plan, no provider. */
export function freeSubscription(accountId: string, now: number): Subscription {
  return { accountId, planId: 'free', status: 'active', provider: 'none', updatedAt: now };
}

/**
 * Entitlements actually in force. `active`/`trialing` grant the plan. `past_due`
 * keeps the plan until the paid period ends (a card retry shouldn't instantly
 * strip access), then drops to free. `canceled`/`incomplete` are free. In every
 * case this only governs NEW expanding actions — never the release path.
 */
export function effectiveEntitlements(sub: Subscription | undefined, now: number): Entitlements {
  if (sub === undefined) return entitlementsFor('free');
  switch (sub.status) {
    case 'active':
    case 'trialing':
      return entitlementsFor(sub.planId);
    case 'past_due':
      if (sub.currentPeriodEnd !== undefined && now <= sub.currentPeriodEnd) {
        return entitlementsFor(sub.planId);
      }
      return entitlementsFor('free');
    case 'canceled':
    case 'incomplete':
    default:
      return entitlementsFor('free');
  }
}

/** A short, plain status line for the account's plan panel. */
export function statusLabel(sub: Subscription): string {
  switch (sub.status) {
    case 'active':
      return 'Active';
    case 'trialing':
      return 'Trial';
    case 'past_due':
      return 'Payment overdue — access continues to the end of the paid period';
    case 'canceled':
      return 'Cancelled — reverted to the free plan';
    case 'incomplete':
      return 'Setup not finished';
    default:
      return 'Unknown';
  }
}
