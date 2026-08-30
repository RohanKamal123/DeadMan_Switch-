// Invariant 7: every state transition (and outreach attempt) is logged
// immutably. Invariant 6 / DECISIONS.md 5.3: the log stores metadata only —
// never content, a URL, or an access code.

import { AuditLog, assertMetadataSafe, SensitiveMetadataError } from '../../src/domain/audit';
import { Machine } from '../../src/domain/machine';
import { T0, daysAfter } from '../support/factory';

describe('invariant 7 — immutable audit log', () => {
  it('appends an entry for every accepted transition with increasing seq', () => {
    const m = new Machine({ now: T0 });
    const r1 = m.apply({ type: 'MISSED_CHECK_IN', at: daysAfter(T0, 7) });
    expect(r1.ok).toBe(true);
    const r2 = m.apply({ type: 'REACH_VERIFYING', at: daysAfter(T0, 30) });
    expect(r2.ok).toBe(true);

    const entries = m.audit.all();
    expect(entries.length).toBe(2);
    expect(entries[0]!.seq).toBe(1);
    expect(entries[1]!.seq).toBe(2);
    expect(entries[0]!.from).toBe('ACTIVE');
    expect(entries[0]!.to).toBe('NUDGE');
    expect(entries[1]!.to).toBe('VERIFYING');
  });

  it('does not append an entry for a rejected transition', () => {
    const m = new Machine({ now: T0 });
    const r = m.apply({ type: 'REACH_VERIFYING', at: daysAfter(T0, 5) }); // too early, from ACTIVE
    expect(r.ok).toBe(false);
    expect(m.audit.all().length).toBe(0);
  });

  it('entries are frozen and the returned list cannot mutate the log', () => {
    const log = new AuditLog();
    const e = log.append({ at: T0, kind: 'TRANSITION', event: 'X', metadata: {} });
    expect(Object.isFrozen(e)).toBe(true);
    expect(() => {
      // @ts-expect-error runtime immutability check
      e.seq = 999;
    }).toThrow();
    const all = log.all();
    expect(() => {
      // @ts-expect-error runtime immutability check
      all.push(e);
    }).toThrow();
    expect(log.all().length).toBe(1);
  });

  it('rejects metadata carrying content, a URL, or a code (invariant 6)', () => {
    expect(() => assertMetadataSafe({ url: 'https://vault.example/x' })).toThrow(
      SensitiveMetadataError,
    );
    expect(() => assertMetadataSafe({ code: '123456' })).toThrow(SensitiveMetadataError);
    expect(() => assertMetadataSafe({ content: 'a secret note' })).toThrow(
      SensitiveMetadataError,
    );
    expect(() => assertMetadataSafe({ note: 'see https://x.example/link' })).toThrow(
      SensitiveMetadataError,
    );
  });

  it('accepts safe metadata (counts, groups, elapsed days, ids)', () => {
    expect(() =>
      assertMetadataSafe({ distinctGroups: 3, operatorId: 'op-1', elapsedDays: 30 }),
    ).not.toThrow();
  });

  it('the audit log never records content even when the effect delivers it', () => {
    const m = new Machine({ now: T0, evidenceMode: 'lenient' });
    m.apply({ type: 'MISSED_CHECK_IN', at: daysAfter(T0, 7) });
    m.apply({ type: 'REACH_VERIFYING', at: daysAfter(T0, 30) });
    for (const c of ['family', 'friend', 'colleague'] as const) {
      m.apply({
        type: 'RECORD_CONFIRMATION',
        at: daysAfter(T0, 31),
        confirmation: { contactId: `c-${c}`, group: c, recordingOperatorId: 'op-1', at: daysAfter(T0, 31) },
      });
    }
    m.apply({ type: 'START_HOLD', at: daysAfter(T0, 31), operatorId: 'op-1' });
    const rel = m.apply({ type: 'TRIGGER_PRIVATE_RELEASE', at: daysAfter(T0, 62), operatorId: 'op-1' });
    expect(rel.ok).toBe(true);
    // Every entry's metadata must be safe — asserted structurally.
    for (const entry of m.audit.all()) {
      expect(() => assertMetadataSafe(entry.metadata)).not.toThrow();
    }
  });
});
