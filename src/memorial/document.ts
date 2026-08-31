// The public-release DESTINATION model (PRODUCT_SPEC.md §PUBLIC_RELEASE).
//
// Public release is the one irreversible step, and it happens only if the user
// turned it on and only 14 days after private release — the machine enforces
// both. This module defines WHAT gets published (a quiet, dignified memorial
// document) and the SOURCE the publisher reads it from. The source is a port so
// the concrete "which payloads are public, and how they render" decision is a
// deployment concern; the death-path orchestration stays independent of it.
//
// A memorial is addressed by an opaque handle, never the account id, so the
// public URL cannot be walked back to an account.

import { createHash } from 'node:crypto';

export interface MemorialBlock {
  readonly kind: 'passage' | 'note';
  readonly text: string;
}

export interface MemorialDocument {
  /** Opaque, stable, unguessable-from-account public handle. */
  readonly handle: string;
  /** The name the user chose to be remembered by (their words, set in advance). */
  readonly displayName: string;
  /** A short line beneath the name. Optional. */
  readonly epitaph?: string;
  readonly blocks: readonly MemorialBlock[];
  /** Epoch ms the memorial was published. */
  readonly publishedAt: number;
}

/**
 * Where the publisher reads an account's public memorial from. A deployment
 * implements this over the user's designated public content; the in-memory
 * implementation below serves tests and local dev.
 */
export interface PublicContentSource {
  publicDocumentFor(accountId: string): Omit<MemorialDocument, 'publishedAt'> | undefined;
}

/** A deterministic, opaque handle for an account (sha256, truncated). */
export function defaultHandleFor(accountId: string): string {
  return createHash('sha256').update(`memorial:${accountId}`).digest('hex').slice(0, 24);
}

/** An in-memory source for tests/dev: register a document per account. */
export class InMemoryPublicContentSource implements PublicContentSource {
  private readonly byAccount = new Map<string, Omit<MemorialDocument, 'publishedAt'>>();

  set(accountId: string, doc: Omit<MemorialDocument, 'publishedAt'>): void {
    this.byAccount.set(accountId, doc);
  }

  publicDocumentFor(accountId: string): Omit<MemorialDocument, 'publishedAt'> | undefined {
    return this.byAccount.get(accountId);
  }
}
