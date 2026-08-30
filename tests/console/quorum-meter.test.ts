// The quorum meter read-model (UX_SPEC.md §3.3 / §3.4): it shows GROUPS, not a
// raw count, so an operator sees that two family confirmations still count as
// one group; it explains why Start HOLD is disabled; and it applies the
// self-dealing exclusion per recipient (DECISIONS.md 10.2 / 10.3).

import {
  quorumMeter,
  recipientEligibility,
  holdStartReadiness,
} from '../../src/console/quorum-meter';
import type { Confirmation } from '../../src/domain/quorum';

const at = 1_700_000_000_000;
function conf(contactId: string, group: Confirmation['group']): Confirmation {
  return { contactId, group, recordingOperatorId: 'op-1', at };
}

describe('quorumMeter', () => {
  it('reports all four groups with per-group confirmed status', () => {
    const m = quorumMeter([conf('a', 'family'), conf('b', 'friend')]);
    expect(m.groups).toHaveLength(4);
    const byGroup = Object.fromEntries(m.groups.map((g) => [g.group, g.confirmed]));
    expect(byGroup).toEqual({ family: true, friend: true, colleague: false, other: false });
  });

  it('two confirmations in one group count as one group', () => {
    const m = quorumMeter([conf('a', 'family'), conf('b', 'family'), conf('c', 'friend')]);
    expect(m.distinctGroups).toBe(2);
    expect(m.met).toBe(false);
    expect(m.missingGroups).toBe(1);
  });

  it('is met at three distinct groups', () => {
    const m = quorumMeter([conf('a', 'family'), conf('b', 'friend'), conf('c', 'colleague')]);
    expect(m.met).toBe(true);
    expect(m.missingGroups).toBe(0);
  });

  it('recipientEligibility excludes the recipient own confirmation (self-dealing)', () => {
    const confs = [conf('a', 'family'), conf('b', 'friend'), conf('c-both', 'other')];
    // Global quorum is met, but delivering to c-both must exclude c-both.
    expect(quorumMeter(confs).met).toBe(true);
    const elig = recipientEligibility(confs, 'c-both');
    expect(elig.deliverable).toBe(false);
    expect(elig.reason).toMatch(/self-dealing|own confirmation/i);
  });

  it('recipientEligibility stays deliverable when a spare group covers the exclusion', () => {
    const confs = [
      conf('a', 'family'),
      conf('b', 'friend'),
      conf('c', 'colleague'),
      conf('c-both', 'other'),
    ];
    expect(recipientEligibility(confs, 'c-both').deliverable).toBe(true);
  });

  it('a recipient who never confirmed is deliverable on global quorum', () => {
    const confs = [conf('a', 'family'), conf('b', 'friend'), conf('c', 'colleague')];
    expect(recipientEligibility(confs, 'r-1').deliverable).toBe(true);
  });
});

describe('holdStartReadiness', () => {
  const three = [
    { contactId: 'a', group: 'family' as const, recordingOperatorId: 'op', at },
    { contactId: 'b', group: 'friend' as const, recordingOperatorId: 'op', at },
    { contactId: 'c', group: 'colleague' as const, recordingOperatorId: 'op', at },
  ];

  it('is ready in VERIFYING with quorum, healthy deps, and no freeze', () => {
    const r = holdStartReadiness({
      state: 'VERIFYING',
      confirmations: three,
      dependencyHealthOk: true,
      adminFrozen: false,
    });
    expect(r.canStart).toBe(true);
    expect(r.reasons).toHaveLength(0);
  });

  it('lists the missing-group reason when quorum is short', () => {
    const r = holdStartReadiness({
      state: 'VERIFYING',
      confirmations: [three[0]!, three[1]!],
      dependencyHealthOk: true,
      adminFrozen: false,
    });
    expect(r.canStart).toBe(false);
    expect(r.reasons.join(' ')).toMatch(/group/i);
  });

  it('lists every blocking reason at once', () => {
    const r = holdStartReadiness({
      state: 'STALLED',
      confirmations: [three[0]!],
      dependencyHealthOk: false,
      adminFrozen: true,
    });
    expect(r.canStart).toBe(false);
    expect(r.reasons.length).toBeGreaterThanOrEqual(3);
  });
});
