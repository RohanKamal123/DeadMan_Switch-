// Data retention (DECISIONS.md 5.1 / 5.2 / 5.3). Content purges 30 days after
// final release; a living user's soft-delete hard-deletes after a 7-day grace;
// the immutable audit log keeps metadata only and is NEVER touched by a purge.

import { AuditLog } from '../../src/domain/audit';
import {
  purgeDueAt,
  isPurgeDue,
  hardDeleteDueAt,
  canRecoverSoftDeleted,
  purgeIfDue,
  hardDeleteIfDue,
} from '../../src/retention/retention';
import { DAY_MS, POST_RELEASE_RETENTION_DAYS, SOFT_DELETE_GRACE_DAYS } from '../../src/domain/config';

const RELEASED = 1_700_000_000_000;

describe('retention schedules', () => {
  it('purge falls 30 days after final release', () => {
    expect(purgeDueAt(RELEASED)).toBe(RELEASED + POST_RELEASE_RETENTION_DAYS * DAY_MS);
    expect(isPurgeDue(RELEASED, RELEASED + 29 * DAY_MS)).toBe(false);
    expect(isPurgeDue(RELEASED, RELEASED + 30 * DAY_MS)).toBe(true);
  });

  it('hard delete falls 7 days after a soft delete; recovery is possible until then', () => {
    expect(hardDeleteDueAt(RELEASED)).toBe(RELEASED + SOFT_DELETE_GRACE_DAYS * DAY_MS);
    expect(canRecoverSoftDeleted(RELEASED, RELEASED + 6 * DAY_MS)).toBe(true);
    expect(canRecoverSoftDeleted(RELEASED, RELEASED + 7 * DAY_MS)).toBe(false);
  });
});

describe('purgeIfDue', () => {
  it('does not purge before the window closes', () => {
    const audit = new AuditLog();
    const r = purgeIfDue({ finalReleaseAt: RELEASED, payloadIds: ['p1', 'p2'], audit, at: RELEASED + 10 * DAY_MS });
    expect(r.purged).toBe(false);
    expect(r.purgedCount).toBe(0);
  });

  it('purges content once due and preserves the audit trail', () => {
    const audit = new AuditLog();
    audit.append({ at: RELEASED, kind: 'TRANSITION', event: 'TRIGGER_PRIVATE_RELEASE', metadata: {} });
    const before = audit.length;

    const r = purgeIfDue({ finalReleaseAt: RELEASED, payloadIds: ['p1', 'p2'], audit, at: RELEASED + 30 * DAY_MS });
    expect(r.purged).toBe(true);
    expect(r.purgedCount).toBe(2);

    // The pre-existing entry survives, and a purge entry is added (metadata only).
    expect(audit.length).toBe(before + 1);
    const purgeEntry = audit.all().find((e) => e.event === 'PURGE_CONTENT');
    expect(purgeEntry).toBeDefined();
    // No payload ids leak into the trail — count only.
    const values = Object.values(purgeEntry!.metadata).join(' ');
    expect(values).not.toMatch(/p1|p2/);
  });
});

describe('hardDeleteIfDue', () => {
  it('does not hard delete during the grace period', () => {
    const audit = new AuditLog();
    const r = hardDeleteIfDue({ softDeletedAt: RELEASED, payloadIds: ['p1'], audit, at: RELEASED + 3 * DAY_MS });
    expect(r.deleted).toBe(false);
  });

  it('hard deletes after the 7-day grace and logs metadata only', () => {
    const audit = new AuditLog();
    const r = hardDeleteIfDue({ softDeletedAt: RELEASED, payloadIds: ['p1'], audit, at: RELEASED + 7 * DAY_MS });
    expect(r.deleted).toBe(true);
    expect(audit.all().some((e) => e.event === 'HARD_DELETE')).toBe(true);
  });
});
