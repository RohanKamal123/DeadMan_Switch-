import {
  allPlans,
  entitlementsFor,
  effectiveEntitlements,
  freeSubscription,
  checkAddRecipient,
  checkAddContact,
  checkPublicRelease,
  checkStrictMode,
  type Subscription,
} from '../../src/billing';

describe('billing plans and entitlements', () => {
  it('the free plan is the least-access default', () => {
    const free = entitlementsFor('free');
    expect(free.maxRecipients).toBe(1);
    expect(free.publicRelease).toBe(false);
    expect(free.strictMode).toBe(false);
  });

  it('an unknown plan id fails safe to free', () => {
    expect(entitlementsFor(undefined).planId).toBe('free');
  });

  it('each catalogue plan is at least as permissive as the previous', () => {
    const [free, personal, vault] = allPlans().map((p) => p.entitlements);
    expect(personal.maxRecipients).toBeGreaterThan(free.maxRecipients);
    expect(vault.maxRecipients).toBeGreaterThan(personal.maxRecipients);
    expect(vault.prioritySupport).toBe(true);
  });

  it('gates block expansion at the cap and allow below it', () => {
    const ent = entitlementsFor('free'); // 1 recipient, 3 contacts
    expect(checkAddRecipient(0, ent).ok).toBe(true);
    expect(checkAddRecipient(1, ent).ok).toBe(false);
    expect(checkAddContact(2, ent).ok).toBe(true);
    expect(checkAddContact(3, ent).ok).toBe(false);
    expect(checkPublicRelease(ent).ok).toBe(false);
    expect(checkStrictMode(ent).ok).toBe(false);
    expect(checkPublicRelease(entitlementsFor('personal')).ok).toBe(true);
  });

  it('a lapsed subscription drops NEW-action entitlements to free but keeps a grace to period end', () => {
    const base: Subscription = { accountId: 'a', planId: 'personal', status: 'past_due', provider: 'stripe', currentPeriodEnd: 2000, updatedAt: 0 };
    // within grace
    expect(effectiveEntitlements(base, 1500).publicRelease).toBe(true);
    // after grace
    expect(effectiveEntitlements(base, 2500).publicRelease).toBe(false);
    // canceled → free immediately
    expect(effectiveEntitlements({ ...base, status: 'canceled' }, 1500).publicRelease).toBe(false);
  });

  it('a synthetic free subscription is active on the free plan', () => {
    const sub = freeSubscription('a', 10);
    expect(sub.planId).toBe('free');
    expect(sub.status).toBe('active');
    expect(sub.provider).toBe('none');
  });
});
