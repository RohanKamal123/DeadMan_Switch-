// Invariant 1: CANCELLED is reachable from EVERY state, unconditionally, with
// no grace period and no point of no return (PRODUCT_SPEC.md invariant 1 / §CANCELLED).

import { STATES } from '../../src/domain/states';
import { transition } from '../../src/domain/transition';
import { machineIn, T0 } from '../support/factory';

describe('invariant 1 — CANCELLED reachable from every state', () => {
  for (const state of STATES) {
    it(`cancels from ${state} unconditionally`, () => {
      const m = machineIn(state);
      const r = transition(m, { type: 'CANCEL', at: T0, source: 'user' });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.machine.state).toBe('CANCELLED');
    });
  }

  it('cancel wipes confirmations and resets timers (§CANCELLED)', () => {
    const m = machineIn('HOLD');
    const r = transition(m, { type: 'CANCEL', at: T0, source: 'user' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.machine.confirmations).toHaveLength(0);
    expect(r.machine.holdStartedAt).toBeNull();
    expect(r.machine.deathCertificateUploaded).toBe(false);
    expect(r.effects).toEqual(
      expect.arrayContaining(['WIPE_CONFIRMATIONS', 'RESET_TIMERS', 'NOTIFY_FALSE_ALARM']),
    );
  });

  it('cancel is not blocked by an admin freeze', () => {
    const m = machineIn('HOLD', { adminFrozen: true });
    const r = transition(m, { type: 'CANCEL', at: T0, source: 'user' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.machine.state).toBe('CANCELLED');
  });

  it('cancel fires even one instant before release would (from HOLD at full elapse)', () => {
    // Machine is fully elapsed and could be released this instant; cancel still wins.
    const m = machineIn('HOLD', { holdStartedAt: T0 });
    const at = T0 + 30 * 24 * 60 * 60 * 1000; // exactly the lenient window
    const r = transition(m, { type: 'CANCEL', at, source: 'cancel-link' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.machine.state).toBe('CANCELLED');
  });

  it('CANCELLED returns to ACTIVE unconditionally (§CANCELLED "return to ACTIVE")', () => {
    const m = machineIn('CANCELLED');
    const r = transition(m, { type: 'RESET', at: T0 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.machine.state).toBe('ACTIVE');
  });
});
