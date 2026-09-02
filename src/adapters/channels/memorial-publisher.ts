// The concrete public-release publisher (a PublicPublisher). It is a dumb pipe,
// exactly like the other channel adapters: invoked only once the machine is in
// PUBLIC_RELEASE (the 14-day gap after private release, enforced by the machine
// and re-checked by PublicReleaseService), it reads the account's designated
// public document from the content source and writes it to the durable memorial
// store under an opaque handle. It makes no state decision and advances nothing.
//
// If the account has no public document prepared, it still publishes a minimal,
// dignified in-memoriam record rather than throwing — a publish call in
// PUBLIC_RELEASE must not fail the death path, and an empty destination is safe.

import type { PublicPublisher } from './ports';
import {
  type MemorialDocument,
  type PublicContentSource,
  defaultHandleFor,
} from '../../memorial/document';
import type { MemorialStore } from '../../memorial/store';

export interface MemorialPublisherOptions {
  readonly source: PublicContentSource;
  readonly store: MemorialStore;
  /** Maps an account to its opaque public handle. Defaults to a sha256 digest. */
  readonly handleFor?: (accountId: string) => string;
}

export class MemorialPublisher implements PublicPublisher {
  private readonly source: PublicContentSource;
  private readonly store: MemorialStore;
  private readonly handleFor: (accountId: string) => string;

  constructor(options: MemorialPublisherOptions) {
    this.source = options.source;
    this.store = options.store;
    this.handleFor = options.handleFor ?? defaultHandleFor;
  }

  publish(accountId: string, at: number): void {
    const prepared = this.source.publicDocumentFor(accountId);
    const handle = prepared?.handle ?? this.handleFor(accountId);
    const doc: MemorialDocument =
      prepared === undefined
        ? { handle, displayName: 'In memoriam', blocks: [], publishedAt: at }
        : { ...prepared, handle, publishedAt: at };
    this.store.put(doc);
  }
}
