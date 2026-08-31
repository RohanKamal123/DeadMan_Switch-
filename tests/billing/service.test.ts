import { InMemoryKeyValueStore } from '../../src/persistence';
import {
  BillingService,
  FakeBillingGateway,
  SubscriptionRepository,
  type BillingEvent,
} from '../../src/billing';

function build() {
  const store = new InMemoryKeyValueStore();
  const subscriptions = new SubscriptionRepository(store);
  const gateway = new FakeBillingGateway({ webhookSecret: 'wh' });
  const service = new BillingService({ subscriptions, gateway, now: () => 1000 });
  return { subscriptions, gateway, service };
}

describe('BillingService', () => {
  it('defaults an unknown account to the free plan', () => {
    const { service } = build();
    expect(service.subscription('nobody').planId).toBe('free');
    expect(service.entitlements('nobody').maxRecipients).toBe(1);
  });

  it('refuses checkout for the free plan and creates a session for a paid plan', async () => {
    const { service, gateway } = build();
    expect((await service.startCheckout('a', 'free', { successUrl: 's', cancelUrl: 'c' })).ok).toBe(false);
    const paid = await service.startCheckout('a', 'personal', { successUrl: 's', cancelUrl: 'c' });
    expect(paid.ok).toBe(true);
    expect(gateway.checkouts).toHaveLength(1);
    expect(gateway.checkouts[0].planId).toBe('personal');
  });

  it('rejects a webhook with a bad signature and does not mutate', () => {
    const { service, subscriptions } = build();
    const body = JSON.stringify({ kind: 'subscription-set', accountId: 'a', customerId: 'cus', subscriptionId: 'sub', planId: 'personal', status: 'active' });
    const out = service.applyWebhook(body, 'wrong-signature');
    expect(out.status).toBe(400);
    expect(subscriptions.get('a')).toBeUndefined();
  });

  it('applies a verified subscription-set and upgrades entitlements', () => {
    const { service, gateway, subscriptions } = build();
    const event: BillingEvent = { kind: 'subscription-set', accountId: 'a', customerId: 'cus_1', subscriptionId: 'sub_1', planId: 'personal', status: 'active', currentPeriodEnd: 9999 };
    const body = JSON.stringify(event);
    const out = service.applyWebhook(body, gateway.sign(body));
    expect(out.status).toBe(200);
    expect(out.handled).toBe(true);
    expect(subscriptions.get('a')!.planId).toBe('personal');
    expect(service.entitlements('a').publicRelease).toBe(true);
  });

  it('resolves a later event by customer id when accountId is absent, then cancels', () => {
    const { service, gateway, subscriptions } = build();
    const set = JSON.stringify({ kind: 'subscription-set', accountId: 'a', customerId: 'cus_1', subscriptionId: 'sub_1', planId: 'vault', status: 'active' });
    service.applyWebhook(set, gateway.sign(set));

    // Renewal with no accountId, resolved via customerId.
    const renew = JSON.stringify({ kind: 'subscription-set', customerId: 'cus_1', subscriptionId: 'sub_1', planId: 'personal', status: 'active' });
    service.applyWebhook(renew, gateway.sign(renew));
    expect(subscriptions.get('a')!.planId).toBe('personal');

    const cancel = JSON.stringify({ kind: 'subscription-canceled', customerId: 'cus_1', subscriptionId: 'sub_1' });
    const out = service.applyWebhook(cancel, gateway.sign(cancel));
    expect(out.handled).toBe(true);
    expect(subscriptions.get('a')!.status).toBe('canceled');
    expect(service.entitlements('a').maxRecipients).toBe(1); // back to free for new actions
  });

  it('opens the portal only once a customer exists', async () => {
    const { service, gateway, subscriptions } = build();
    expect((await service.openPortal('a', 'r')).ok).toBe(false);
    subscriptions.save({ accountId: 'a', planId: 'personal', status: 'active', provider: 'stripe', customerId: 'cus_9', updatedAt: 0 });
    const portal = await service.openPortal('a', 'https://ret.test');
    expect(portal.ok).toBe(true);
    expect(gateway.portals[0].customerId).toBe('cus_9');
  });
});
