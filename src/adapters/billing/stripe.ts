// Phase (billing) — the concrete Stripe adapter (the ONLY place a Stripe detail
// lives). It implements the BillingGateway port over Stripe's REST API using the
// platform `fetch` — no SDK, so nothing Stripe-shaped escapes this file, exactly
// as the vendor-adapter rule in CLAUDE.md requires. Webhook verification uses
// Stripe's documented scheme (HMAC-SHA256 over `${timestamp}.${body}`) with a
// timing-safe compare and a replay tolerance; a bad or stale signature returns
// null and the service rejects the request.
//
// The adapter is test-mode ready: it reads its secret key, webhook secret, and
// price ids from injected config, so pointing it at live Stripe is a config
// change, not a code change. Until real keys are set it simply is not wired in
// (composition falls back to the in-process gateway).

import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  type BillingEvent,
  type BillingGateway,
  type CheckoutRequest,
  type HostedSession,
  type PortalRequest,
} from '../../billing/gateway';
import { isPlanId, type PlanId } from '../../billing/plans';
import type { SubscriptionStatus } from '../../billing/subscription';

type FetchLike = (url: string, init: RequestInit) => Promise<{ ok: boolean; status: number; text(): Promise<string>; json(): Promise<unknown> }>;

export interface StripeGatewayOptions {
  readonly secretKey: string;
  readonly webhookSecret: string;
  /** Map plan id → Stripe price id (for creating checkout). */
  readonly priceByPlan: Readonly<Record<Exclude<PlanId, 'free'>, string>>;
  /** Map Stripe price id → plan id (for reading subscription events). */
  readonly planByPrice: Readonly<Record<string, PlanId>>;
  readonly apiBase?: string;
  /** Replay tolerance in seconds (default 300). */
  readonly toleranceSeconds?: number;
  readonly fetchImpl?: FetchLike;
  readonly now?: () => number;
}

/** Map Stripe's subscription statuses onto ours, failing safe toward less access. */
function mapStatus(raw: unknown): SubscriptionStatus {
  switch (raw) {
    case 'active':
      return 'active';
    case 'trialing':
      return 'trialing';
    case 'past_due':
    case 'paused':
      return 'past_due';
    case 'incomplete':
      return 'incomplete';
    case 'canceled':
    case 'incomplete_expired':
    case 'unpaid':
    default:
      return 'canceled';
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

export class StripeBillingGateway implements BillingGateway {
  private readonly opt: StripeGatewayOptions;
  private readonly fetchImpl: FetchLike;
  private readonly apiBase: string;
  private readonly now: () => number;
  private readonly tolerance: number;

  constructor(options: StripeGatewayOptions) {
    this.opt = options;
    this.fetchImpl = options.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
    this.apiBase = options.apiBase ?? 'https://api.stripe.com';
    this.now = options.now ?? Date.now;
    this.tolerance = options.toleranceSeconds ?? 300;
  }

  private async post(path: string, form: Record<string, string>): Promise<Record<string, unknown>> {
    const res = await this.fetchImpl(`${this.apiBase}${path}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.opt.secretKey}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams(form).toString(),
    });
    const parsed = asRecord(await res.json());
    if (!res.ok) {
      const err = asRecord(parsed['error']);
      throw new Error(`stripe ${path} failed (${res.status}): ${String(err['message'] ?? 'unknown')}`);
    }
    return parsed;
  }

  async createCheckoutSession(req: CheckoutRequest): Promise<HostedSession> {
    if (req.planId === 'free') throw new Error('checkout is not used for the free plan');
    const price = this.opt.priceByPlan[req.planId as Exclude<PlanId, 'free'>];
    if (price === undefined) throw new Error(`no Stripe price configured for plan ${req.planId}`);
    const form: Record<string, string> = {
      mode: 'subscription',
      'line_items[0][price]': price,
      'line_items[0][quantity]': '1',
      success_url: req.successUrl,
      cancel_url: req.cancelUrl,
      client_reference_id: req.accountId,
      'metadata[accountId]': req.accountId,
      'metadata[planId]': req.planId,
      'subscription_data[metadata][accountId]': req.accountId,
      'subscription_data[metadata][planId]': req.planId,
    };
    if (req.customerId !== undefined) form['customer'] = req.customerId;
    const out = await this.post('/v1/checkout/sessions', form);
    const url = out['url'];
    if (typeof url !== 'string') throw new Error('stripe checkout returned no url');
    return { url };
  }

  async createPortalSession(req: PortalRequest): Promise<HostedSession> {
    const out = await this.post('/v1/billing_portal/sessions', {
      customer: req.customerId,
      return_url: req.returnUrl,
    });
    const url = out['url'];
    if (typeof url !== 'string') throw new Error('stripe portal returned no url');
    return { url };
  }

  verifyAndParseWebhook(rawBody: string, signatureHeader: string | undefined): BillingEvent | null {
    if (!this.verifySignature(rawBody, signatureHeader)) return null;
    let event: Record<string, unknown>;
    try {
      event = asRecord(JSON.parse(rawBody));
    } catch {
      return null;
    }
    return this.mapEvent(event);
  }

  private verifySignature(rawBody: string, header: string | undefined): boolean {
    if (header === undefined) return false;
    let timestamp: string | undefined;
    const signatures: string[] = [];
    for (const part of header.split(',')) {
      const [k, v] = part.split('=', 2);
      if (k === 't') timestamp = v;
      else if (k === 'v1' && v !== undefined) signatures.push(v);
    }
    if (timestamp === undefined || signatures.length === 0) return false;
    const ts = Number(timestamp);
    if (!Number.isFinite(ts)) return false;
    if (Math.abs(Math.floor(this.now() / 1000) - ts) > this.tolerance) return false;
    const expected = createHmac('sha256', this.opt.webhookSecret).update(`${timestamp}.${rawBody}`).digest('hex');
    const a = Buffer.from(expected);
    return signatures.some((sig) => {
      const b = Buffer.from(sig);
      return a.length === b.length && timingSafeEqual(a, b);
    });
  }

  private mapEvent(event: Record<string, unknown>): BillingEvent {
    const type = event['type'];
    const object = asRecord(asRecord(event['data'])['object']);
    if (type === 'checkout.session.completed') {
      const metadata = asRecord(object['metadata']);
      const planId = typeof metadata['planId'] === 'string' && isPlanId(metadata['planId']) ? metadata['planId'] : undefined;
      const customerId = typeof object['customer'] === 'string' ? object['customer'] : undefined;
      const subscriptionId = typeof object['subscription'] === 'string' ? object['subscription'] : undefined;
      const accountId = typeof metadata['accountId'] === 'string' ? metadata['accountId'] : undefined;
      if (planId === undefined || customerId === undefined || subscriptionId === undefined) return { kind: 'ignored' };
      return {
        kind: 'subscription-set',
        ...(accountId !== undefined ? { accountId } : {}),
        customerId,
        subscriptionId,
        planId,
        status: 'active',
      };
    }
    if (type === 'customer.subscription.updated' || type === 'customer.subscription.created') {
      const subscriptionId = typeof object['id'] === 'string' ? object['id'] : undefined;
      const customerId = typeof object['customer'] === 'string' ? object['customer'] : undefined;
      const items = asRecord(object['items']);
      const first = Array.isArray(items['data']) ? asRecord(items['data'][0]) : {};
      const priceId = typeof asRecord(first['price'])['id'] === 'string' ? (asRecord(first['price'])['id'] as string) : undefined;
      const planId = priceId !== undefined ? this.opt.planByPrice[priceId] : undefined;
      const metadata = asRecord(object['metadata']);
      const accountId = typeof metadata['accountId'] === 'string' ? metadata['accountId'] : undefined;
      if (subscriptionId === undefined || customerId === undefined || planId === undefined) return { kind: 'ignored' };
      const cpe = typeof object['current_period_end'] === 'number' ? object['current_period_end'] * 1000 : undefined;
      return {
        kind: 'subscription-set',
        ...(accountId !== undefined ? { accountId } : {}),
        customerId,
        subscriptionId,
        planId,
        status: mapStatus(object['status']),
        ...(cpe !== undefined ? { currentPeriodEnd: cpe } : {}),
      };
    }
    if (type === 'customer.subscription.deleted') {
      const subscriptionId = typeof object['id'] === 'string' ? object['id'] : undefined;
      const customerId = typeof object['customer'] === 'string' ? object['customer'] : undefined;
      if (subscriptionId === undefined || customerId === undefined) return { kind: 'ignored' };
      return { kind: 'subscription-canceled', subscriptionId, customerId };
    }
    return { kind: 'ignored' };
  }
}
