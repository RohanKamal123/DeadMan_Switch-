// Invariant 5: STALLED never auto-advances toward release. "We couldn't confirm
// it" must never be treated as evidence of death (PRODUCT_SPEC.md §STALLED).
// STALLED moves only on a user cancel/liveness or a deliberate, audited manual
// review that reopens VERIFYING — never directly to HOLD or a release.

import { transition } from '../../src/domain/transition';
import { RELEASE_ADVANCING_STATES } from '../../src/domain/states';
import { machineIn, T0, daysAfter, quorumConfirmations } from '../support/factory';

describe('invariant 5 — STALLED never advances toward release', () => {
  const at = daysAfter(T0, 100);

  it('no event from STALLED produces a release-advancing state', () => {
    // Even with a full quorum already recorded, STALLED cannot be pushed forward.
    const m = machineIn('STALLED', { confirmations: quorumConfirmations(daysAfter(T0, 31)) });
    const events = [
      { type: 'START_HOLD' as const, at, operatorId: 'op-1' },
      { type: 'TRIGGER_PRIVATE_RELEASE' as const, at, operatorId: 'op-1' },
      { type: 'TRIGGER_PUBLIC_RELEASE' as const, at, operatorId: 'op-1' },
      { type: 'RECORD_CONFIRMATION' as const, at, confirmation: quorumConfirmations()[0]! },
      { type: 'MISSED_CHECK_IN' as const, at },
      { type: 'REACH_VERIFYING' as const, at },
      { type: 'UPLOAD_DEATH_CERTIFICATE' as const, at, operatorId: 'op-1' },
    ];
    for (const ev of events) {
      const r = transition(m, ev);
      if (r.ok) {
        expect(RELEASE_ADVANCING_STATES).not.toContain(r.machine.state);
      }
    }
  });

  it('START_HOLD is rejected directly from STALLED even with quorum', () => {
    const m = machineIn('STALLED', { confirmations: quorumConfirmations(daysAfter(T0, 31)) });
    const r = transition(m, { type: 'START_HOLD', at, operatorId: 'op-1' });
    expect(r.ok).toBe(false);
  });

  it('a deliberate manual review reopens VERIFYING (not HOLD)', () => {
    const m = machineIn('STALLED');
    const r = transition(m, { type: 'REOPEN_VERIFICATION', at, operatorId: 'op-1' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.machine.state).toBe('VERIFYING');
  });

  it('a user liveness signal returns STALLED to ACTIVE', () => {
    const m = machineIn('STALLED');
    const r = transition(m, { type: 'CHECK_IN', at });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.machine.state).toBe('ACTIVE');
  });

  it('no console field can force STALLED past VERIFYING in one step', () => {
    // Reopen to VERIFYING, then a release trigger must still fail until HOLD.
    const m = machineIn('STALLED');
    const reopened = transition(m, { type: 'REOPEN_VERIFICATION', at, operatorId: 'op-1' });
    expect(reopened.ok).toBe(true);
    if (!reopened.ok) return;
    const r = transition(reopened.machine, {
      type: 'TRIGGER_PRIVATE_RELEASE',
      at: daysAfter(T0, 200),
      operatorId: 'op-1',
    });
    expect(r.ok).toBe(false);
  });
});
