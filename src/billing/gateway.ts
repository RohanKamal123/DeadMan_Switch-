// Billing — the payment-provider PORT. The billing service depends on this
// interface, never on a provider SDK, mirroring the vendor-adapter rule in
// CLAUDE.md: no payment SDK import escapes its adapter directory, so swapping
// Stripe for another provider is a one-file change. A concrete Stripe adapter
// lives in src/adapters/billing/; a Fake lives here for tests.

import { createHmac, timingSafeEqual } from 'node:crypto';
import type { PlanId } from './plans';
import type { SubscriptionStatus } from './subscription';

export interface CheckoutRequest {
  readonly accountId: string;
  readonly planId: PlanId;
  readonly customerId?: string;
  readonly successUrl: string;
  readonly cancelUrl: string;
}

export interface PortalRequest {
  readonly customerId: string;
  readonly returnUrl: string;
}

export interface HostedSession {
  /** The provider-hosted URL to redirect the user to. */
  readonly url: string;
}

/**
 * A provider webhook, normalised to what the service needs. The adapter verifies
 * the signature and maps provider event types onto these; unrecognised events
 * become `{ kind: 'ignored' }` so the handler can 200 them without acting.
 */
export type BillingEvent =
  | {
      readonly kind: 'subscription-set';
      readonly accountId?: string;
      readonly customerId: string;
      readonly subscriptionId: string;
      readonly planId: PlanId;
      readonly status: SubscriptionStatus;
      readonly currentPeriodEnd?: number;
    }
  | {
      readonly kind: 'subscription-canceled';
      readonly customerId: string;
      readonly subscriptionId: string;
    }
  | { readonly kind: 'ignored' };

export interface BillingGateway {
  createCheckoutSession(req: CheckoutRequest): Promise<HostedSession>;
  createPortalSession(req: PortalRequest): Promise<HostedSession>;
  /**
   * Verify a raw webhook body against its signature header and parse it into a
   * normalised event. Returns null when the signature is invalid or missing —
   * the handler must treat null as "reject, do not act."
   */
  verifyAndParseWebhook(rawBody: string, signatureHeader: string | undefined): BillingEvent | null;
}

// --- Fake, for tests and local dev (no network) -----------------------------

export interface FakeGatewayOptions {
  /** Shared secret the fake signs/verifies webhooks with (HMAC-SHA256 of the body). */
  readonly webhookSecret?: string;
  /** Base URL the fake pretends to host checkout/portal on. */
  readonly baseUrl?: string;
}

/**
 * A deterministic in-process gateway. `createCheckoutSession` returns a local
 * URL that echoes the request; `verifyAndParseWebhook` accepts a JSON body that
 * IS the normalised event, signed with a simple HMAC so signature handling is
 * exercised in tests exactly as it is in production.
 */
export class FakeBillingGateway implements BillingGateway {
  private readonly secret: string;
  private readonly baseUrl: string;
  readonly checkouts: CheckoutRequest[] = [];
  readonly portals: PortalRequest[] = [];

  constructor(options: FakeGatewayOptions = {}) {
    this.secret = options.webhookSecret ?? 'test-webhook-secret';
    this.baseUrl = options.baseUrl ?? 'https://pay.test';
  }

  createCheckoutSession(req: CheckoutRequest): Promise<HostedSession> {
    this.checkouts.push(req);
    const q = new URLSearchParams({ account: req.accountId, plan: req.planId });
    return Promise.resolve({ url: `${this.baseUrl}/checkout?${q.toString()}` });
  }

  createPortalSession(req: PortalRequest): Promise<HostedSession> {
    this.portals.push(req);
    return Promise.resolve({ url: `${this.baseUrl}/portal/${encodeURIComponent(req.customerId)}` });
  }

  /** Helper for tests: produce the signature header for a given raw body. */
  sign(rawBody: string): string {
    return createHmac('sha256', this.secret).update(rawBody).digest('hex');
  }

  verifyAndParseWebhook(rawBody: string, signatureHeader: string | undefined): BillingEvent | null {
    if (signatureHeader === undefined || rawBody === '') return null;
    const expected = this.sign(rawBody);
    const a = Buffer.from(expected);
    const b = Buffer.from(signatureHeader);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    try {
      return JSON.parse(rawBody) as BillingEvent;
    } catch {
      return null;
    }
  }
}
