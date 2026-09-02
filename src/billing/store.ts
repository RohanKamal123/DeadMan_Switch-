// Billing — the subscription repository. A thin typed view over the shared
// KeyValueStore, keyed by accountId, with the two lookups the webhook path needs
// (by provider customer id and subscription id). At pilot scale a scan is fine
// (DECISIONS.md 7.1); a real index is a later swap behind the same interface.

import { SnapshotRepository, type KeyValueStore } from '../persistence';
import type { Subscription } from './subscription';

export class SubscriptionRepository {
  private readonly repo: SnapshotRepository<Subscription>;

  constructor(store: KeyValueStore) {
    this.repo = new SnapshotRepository<Subscription>(store, 'subscription');
  }

  get(accountId: string): Subscription | undefined {
    return this.repo.get(accountId);
  }

  save(sub: Subscription): void {
    this.repo.save(sub.accountId, sub);
  }

  findByCustomerId(customerId: string): Subscription | undefined {
    return this.repo.all().find((s) => s.customerId === customerId);
  }

  findBySubscriptionId(subscriptionId: string): Subscription | undefined {
    return this.repo.all().find((s) => s.subscriptionId === subscriptionId);
  }
}
