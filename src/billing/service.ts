// Billing — the application service. The ONLY billing code that mutates stored
// state, mirroring the app-service tier: it reads the subscription repository,
// talks to the gateway port, and persists the result. It logs plan changes to
// the immutable audit trail as METADATA ONLY (invariant 7) — never a card, a
// customer email, or a provider secret.

import type { AuditSinkFactory } from '../runtime';
import { type Entitlements, type PlanId } from './plans';
import { type BillingGateway } from './gateway';
import { SubscriptionRepository } from './store';
import {
  type Subscription,
  effectiveEntitlements,
  freeSubscription,
} from './subscription';

export interface BillingServiceOptions {
  readonly subscriptions: SubscriptionRepository;
  readonly gateway: BillingGateway;
  readonly auditFor?: AuditSinkFactory;
  readonly now: () => number;
}

export type BillingResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly reason: string };

export class BillingService {
  private readonly subscriptions: SubscriptionRepository;
  private readonly gateway: BillingGateway;
  private readonly auditFor?: AuditSinkFactory;
  private readonly now: () => number;

  constructor(options: BillingServiceOptions) {
    this.subscriptions = options.subscriptions;
    this.gateway = options.gateway;
    this.auditFor = options.auditFor;
    this.now = options.now;
  }

  /** The stored subscription, or a synthetic free one for an account that never paid. */
  subscription(accountId: string): Subscription {
    return this.subscriptions.get(accountId) ?? freeSubscription(accountId, this.now());
  }

  /** Entitlements in force right now (governs NEW expansions only). */
  entitlements(accountId: string): Entitlements {
    return effectiveEntitlements(this.subscriptions.get(accountId), this.now());
  }

  /** Begin a hosted checkout for a paid plan. The free plan needs no checkout. */
  async startCheckout(
    accountId: string,
    planId: PlanId,
    urls: { successUrl: string; cancelUrl: string },
  ): Promise<BillingResult<string>> {
    if (planId === 'free') return { ok: false, reason: 'The free plan needs no checkout.' };
    const existing = this.subscriptions.get(accountId);
    const session = await this.gateway.createCheckoutSession({
      accountId,
      planId,
      ...(existing?.customerId !== undefined ? { customerId: existing.customerId } : {}),
      successUrl: urls.successUrl,
      cancelUrl: urls.cancelUrl,
    });
    return { ok: true, value: session.url };
  }

  /** Open the provider's billing portal to manage or cancel a paid plan. */
  async openPortal(accountId: string, returnUrl: string): Promise<BillingResult<string>> {
    const sub = this.subscriptions.get(accountId);
    if (sub?.customerId === undefined) {
      return { ok: false, reason: 'No billing account yet — start a plan first.' };
    }
    const session = await this.gateway.createPortalSession({ customerId: sub.customerId, returnUrl });
    return { ok: true, value: session.url };
  }

  /**
   * Verify and apply a provider webhook. Returns the HTTP status the handler
   * should send: 400 when the signature is bad (do not act), 200 otherwise
   * (acted, or safely ignored). A verified event is idempotent — re-applying the
   * same state is a no-op write.
   */
  applyWebhook(rawBody: string, signatureHeader: string | undefined): { readonly status: number; readonly handled: boolean } {
    const event = this.gateway.verifyAndParseWebhook(rawBody, signatureHeader);
    if (event === null) return { status: 400, handled: false };
    if (event.kind === 'ignored') return { status: 200, handled: false };

    if (event.kind === 'subscription-canceled') {
      const target =
        this.subscriptions.findBySubscriptionId(event.subscriptionId) ??
        this.subscriptions.findByCustomerId(event.customerId);
      if (target === undefined) return { status: 200, handled: false };
      const updated: Subscription = { ...target, status: 'canceled', updatedAt: this.now() };
      this.subscriptions.save(updated);
      this.audit(updated);
      return { status: 200, handled: true };
    }

    // subscription-set: upsert from checkout completion or a plan/renewal change.
    const accountId =
      event.accountId ??
      this.subscriptions.findByCustomerId(event.customerId)?.accountId ??
      this.subscriptions.findBySubscriptionId(event.subscriptionId)?.accountId;
    if (accountId === undefined) return { status: 200, handled: false };

    const next: Subscription = {
      accountId,
      planId: event.planId,
      status: event.status,
      provider: 'stripe',
      customerId: event.customerId,
      subscriptionId: event.subscriptionId,
      ...(event.currentPeriodEnd !== undefined ? { currentPeriodEnd: event.currentPeriodEnd } : {}),
      updatedAt: this.now(),
    };
    this.subscriptions.save(next);
    this.audit(next);
    return { status: 200, handled: true };
  }

  /** Log a plan change as metadata only — plan and status, never customer or card. */
  private audit(sub: Subscription): void {
    if (this.auditFor === undefined) return;
    this.auditFor(sub.accountId).append({
      at: this.now(),
      kind: 'CONTEXT',
      event: 'BILLING_PLAN_SET',
      metadata: { planId: sub.planId, status: sub.status, provider: sub.provider },
    });
  }
}
