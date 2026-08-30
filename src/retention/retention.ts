// Data retention (DECISIONS.md 5.1 / 5.2 / 5.3).
//
//   - Content purges 30 days after the final release, then a permanent purge.
//   - A living user's self-deletion is a soft delete with a 7-day grace, then a
//     hard delete; recovery within the grace is manual and audited (8.2).
//   - The immutable audit log keeps METADATA ONLY and is never touched by a
//     purge — these functions only ever APPEND a metadata record of the purge.
//
// The functions gate and log; the caller performs the actual byte deletion on
// the returned signal (the content store lives at the edge). Payload ids are
// never written to the trail — only counts.

import type { AuditLog } from '../domain/audit';
import { DAY_MS, POST_RELEASE_RETENTION_DAYS, SOFT_DELETE_GRACE_DAYS } from '../domain/config';

export function purgeDueAt(finalReleaseAt: number): number {
  return finalReleaseAt + POST_RELEASE_RETENTION_DAYS * DAY_MS;
}

export function isPurgeDue(finalReleaseAt: number, at: number): boolean {
  return at >= purgeDueAt(finalReleaseAt);
}

export function hardDeleteDueAt(softDeletedAt: number): number {
  return softDeletedAt + SOFT_DELETE_GRACE_DAYS * DAY_MS;
}

export function isHardDeleteDue(softDeletedAt: number, at: number): boolean {
  return at >= hardDeleteDueAt(softDeletedAt);
}

/** A soft-deleted account is recoverable (manual, audited) until the grace ends. */
export function canRecoverSoftDeleted(softDeletedAt: number, at: number): boolean {
  return at < hardDeleteDueAt(softDeletedAt);
}

export interface PurgeInput {
  readonly finalReleaseAt: number;
  readonly payloadIds: readonly string[];
  readonly audit: AuditLog;
  readonly at: number;
}

export interface PurgeResult {
  readonly purged: boolean;
  readonly purgedCount: number;
}

export function purgeIfDue(input: PurgeInput): PurgeResult {
  if (!isPurgeDue(input.finalReleaseAt, input.at)) {
    return { purged: false, purgedCount: 0 };
  }
  input.audit.append({
    at: input.at,
    kind: 'CONTEXT',
    event: 'PURGE_CONTENT',
    metadata: { count: input.payloadIds.length },
  });
  return { purged: true, purgedCount: input.payloadIds.length };
}

export interface HardDeleteInput {
  readonly softDeletedAt: number;
  readonly payloadIds: readonly string[];
  readonly audit: AuditLog;
  readonly at: number;
}

export interface HardDeleteResult {
  readonly deleted: boolean;
  readonly deletedCount: number;
}

export function hardDeleteIfDue(input: HardDeleteInput): HardDeleteResult {
  if (!isHardDeleteDue(input.softDeletedAt, input.at)) {
    return { deleted: false, deletedCount: 0 };
  }
  input.audit.append({
    at: input.at,
    kind: 'CONTEXT',
    event: 'HARD_DELETE',
    metadata: { count: input.payloadIds.length },
  });
  return { deleted: true, deletedCount: input.payloadIds.length };
}
