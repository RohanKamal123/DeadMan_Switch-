// The published-memorial store: durable state for the public-release
// destination, over the same KeyValueStore backend as the rest of persistence
// (so in production it survives a restart on the same Postgres/file backend).
// Once published, a memorial is public content — this store holds only what was
// deliberately published, never the account id or private payloads.

import { SnapshotRepository, type KeyValueStore } from '../persistence';
import type { MemorialDocument } from './document';

export class MemorialStore {
  private readonly repo: SnapshotRepository<MemorialDocument>;

  constructor(store: KeyValueStore) {
    this.repo = new SnapshotRepository<MemorialDocument>(store, 'memorial');
  }

  put(doc: MemorialDocument): void {
    this.repo.save(doc.handle, doc);
  }

  get(handle: string): MemorialDocument | undefined {
    return this.repo.get(handle);
  }

  all(): readonly MemorialDocument[] {
    return this.repo.all();
  }
}
