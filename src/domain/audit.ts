// Immutable audit log (PRODUCT_SPEC.md invariant 7; DECISIONS.md 5.3).
//
// The log is append-only and stores METADATA ONLY — timestamps, channels,
// outcomes, operator actions, state transitions. It NEVER stores content, a
// URL, or an access code (invariant 6). `assertMetadataSafe` enforces that at
// runtime so a careless caller cannot leak a secret into the trail.

import type { State } from './states';

export type AuditKind = 'TRANSITION' | 'CONTEXT' | 'OUTREACH';

/** Only primitive, non-sensitive metadata may be logged. */
export type MetadataValue = string | number | boolean;
export type Metadata = Readonly<Record<string, MetadataValue>>;

export interface AuditEntryInput {
  readonly at: number;
  readonly kind: AuditKind;
  readonly event: string;
  readonly from?: State;
  readonly to?: State;
  readonly actor?: string;
  readonly metadata: Metadata;
}

export interface AuditEntry extends AuditEntryInput {
  readonly seq: number;
}

export class SensitiveMetadataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SensitiveMetadataError';
  }
}

// Keys that would name content, a link, or a code. Metadata is a trail, not a
// payload — these never belong in it.
const FORBIDDEN_KEYS = [
  'content',
  'body',
  'text',
  'message',
  'note',
  'url',
  'uri',
  'link',
  'href',
  'code',
  'otp',
  'token',
  'secret',
  'password',
  'ciphertext',
  'plaintext',
  'payload',
  'attachment',
];

const URLISH = /\b(?:https?:\/\/|www\.)\S+/i;

/**
 * Throw if metadata carries anything that looks like content, a URL, or a
 * code. Guards invariants 6 and 7 at the log boundary.
 */
export function assertMetadataSafe(metadata: Metadata): void {
  for (const [key, value] of Object.entries(metadata)) {
    const lowered = key.toLowerCase();
    if (FORBIDDEN_KEYS.some((k) => lowered === k || lowered.endsWith(`_${k}`) || lowered.endsWith(k))) {
      throw new SensitiveMetadataError(`audit metadata key "${key}" may carry content, a URL, or a code`);
    }
    if (typeof value === 'string' && URLISH.test(value)) {
      throw new SensitiveMetadataError(`audit metadata value for "${key}" contains a URL`);
    }
  }
}

export class AuditLog {
  private readonly entries: AuditEntry[] = [];

  append(input: AuditEntryInput): AuditEntry {
    assertMetadataSafe(input.metadata);
    const entry: AuditEntry = Object.freeze({
      ...input,
      metadata: Object.freeze({ ...input.metadata }),
      seq: this.entries.length + 1,
    });
    this.entries.push(entry);
    return entry;
  }

  /** A frozen snapshot; the returned array cannot mutate the log. */
  all(): readonly AuditEntry[] {
    return Object.freeze(this.entries.slice());
  }

  get length(): number {
    return this.entries.length;
  }
}
