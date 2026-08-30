// Invariant 2: no third party is contacted before day 30. Entry to VERIFYING
// (which puts the account on the operator queue and authorises human outreach)
// is the day-30 boundary and never earlier (PRODUCT_SPEC.md §NUDGE / §VERIFYING).

import { STATES } from '../../src/domain/states';
import { transition } from '../../src/domain/transition';
import { VERIFYING_THRESHOLD_DAYS } from '../../src/domain/config';
import { machineIn, T0, daysAfter } from '../support/factory';

const THIRD_PARTY_EFFECTS = [
  'FLAG_OPERATOR_QUEUE',
  'PING_CANCEL_ALL_CHANNELS',
  'NOTIFY_CONFIRMERS_HOLD',
  'DELIVER_PRIVATE',
  'DELIVER_PUBLIC',
];

describe('invariant 2 — no third party before day 30', () => {
  it('rejects VERIFYING entry before day 30', () => {
    const m = machineIn('NUDGE');
    const r = transition(m, { type: 'REACH_VERIFYING', at: daysAfter(T0, 29) });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.machine.state).toBe('NUDGE');
  });

  it('allows VERIFYING entry exactly at day 30 and flags the operator queue', () => {
    const m = machineIn('NUDGE');
    const r = transition(m, {
      type: 'REACH_VERIFYING',
      at: daysAfter(T0, VERIFYING_THRESHOLD_DAYS),
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.machine.state).toBe('VERIFYING');
    expect(r.effects).toContain('FLAG_OPERATOR_QUEUE');
  });

  it('blocks VERIFYING entry when a critical dependency is unhealthy (veto path 3)', () => {
    const m = machineIn('NUDGE', { dependencyHealthOk: false });
    const r = transition(m, {
      type: 'REACH_VERIFYING',
      at: daysAfter(T0, VERIFYING_THRESHOLD_DAYS),
    });
    expect(r.ok).toBe(false);
  });

  it('no ACTIVE or NUDGE transition ever emits a third-party effect', () => {
    for (const state of ['ACTIVE', 'NUDGE'] as const) {
      const before = machineIn(state);
      // Sweep every plausible event; only the user should be reachable.
      const events = [
        { type: 'CHECK_IN' as const, at: daysAfter(T0, 8) },
        { type: 'MISSED_CHECK_IN' as const, at: daysAfter(T0, 8) },
        { type: 'REACH_VERIFYING' as const, at: daysAfter(T0, 29) },
      ];
      for (const ev of events) {
        const r = transition(before, ev);
        if (r.ok) {
          for (const forbidden of THIRD_PARTY_EFFECTS) {
            expect(r.effects).not.toContain(forbidden);
          }
        }
      }
    }
  });

  it('the whole path ACTIVE→NUDGE→VERIFYING never crosses day 30 early', () => {
    let m = machineIn('ACTIVE');
    const missed = transition(m, { type: 'MISSED_CHECK_IN', at: daysAfter(T0, 7) });
    expect(missed.ok).toBe(true);
    if (!missed.ok) return;
    m = missed.machine;
    expect(m.state).toBe('NUDGE');
    // Attempt early verifying at day 21 — must fail.
    const early = transition(m, { type: 'REACH_VERIFYING', at: daysAfter(T0, 21) });
    expect(early.ok).toBe(false);
  });
});
