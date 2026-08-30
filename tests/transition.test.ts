// General behaviour of the single guarded transition function: the happy-path
// lifecycle, liveness resets, health/freeze vetoes, and rejection of nonsense
// transitions. The seven invariants have dedicated suites; this covers the rest.

import { transition, initialMachine } from '../src/domain/transition';
import { machineIn, T0, daysAfter, quorumConfirmations } from './support/factory';

describe('transition — lifecycle', () => {
  it('walks ACTIVE→NUDGE→VERIFYING→HOLD→PRIVATE_RELEASE→PUBLIC_RELEASE', () => {
    let m = initialMachine({ now: T0, evidenceMode: 'lenient', publicReleaseEnabled: true });

    let r = transition(m, { type: 'MISSED_CHECK_IN', at: daysAfter(T0, 7) });
    expect(r.ok && r.machine.state).toBe('NUDGE');
    if (!r.ok) return;
    m = r.machine;

    r = transition(m, { type: 'REACH_VERIFYING', at: daysAfter(T0, 30) });
    expect(r.ok && r.machine.state).toBe('VERIFYING');
    if (!r.ok) return;
    m = r.machine;

    for (const c of quorumConfirmations(daysAfter(T0, 31))) {
      r = transition(m, { type: 'RECORD_CONFIRMATION', at: daysAfter(T0, 31), confirmation: c });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      m = r.machine;
    }

    r = transition(m, { type: 'START_HOLD', at: daysAfter(T0, 31), operatorId: 'op-1' });
    expect(r.ok && r.machine.state).toBe('HOLD');
    if (!r.ok) return;
    m = r.machine;

    r = transition(m, { type: 'TRIGGER_PRIVATE_RELEASE', at: daysAfter(T0, 61), operatorId: 'op-1' });
    expect(r.ok && r.machine.state).toBe('PRIVATE_RELEASE');
    if (!r.ok) return;
    m = r.machine;

    r = transition(m, { type: 'TRIGGER_PUBLIC_RELEASE', at: daysAfter(T0, 75), operatorId: 'op-1' });
    expect(r.ok && r.machine.state).toBe('PUBLIC_RELEASE');
  });

  it('a check-in from ACTIVE stays ACTIVE and resets the liveness clock', () => {
    const m = machineIn('ACTIVE', { lastLivenessAt: T0 });
    const at = daysAfter(T0, 3);
    const r = transition(m, { type: 'CHECK_IN', at });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.machine.state).toBe('ACTIVE');
    expect(r.machine.lastLivenessAt).toBe(at);
  });

  it('a check-in from NUDGE returns to ACTIVE and resets timers', () => {
    const m = machineIn('NUDGE');
    const r = transition(m, { type: 'CHECK_IN', at: daysAfter(T0, 10) });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.machine.state).toBe('ACTIVE');
    expect(r.machine.nudgeStartedAt).toBeNull();
  });

  it('a liveness signal from VERIFYING returns to ACTIVE and notifies false alarm', () => {
    const m = machineIn('VERIFYING');
    const r = transition(m, { type: 'CHECK_IN', at: daysAfter(T0, 31) });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.machine.state).toBe('ACTIVE');
    expect(r.machine.confirmations).toHaveLength(0);
    expect(r.effects).toContain('NOTIFY_FALSE_ALARM');
  });

  it('MISSED_CHECK_IN before the weekly period is rejected', () => {
    const m = machineIn('ACTIVE', { lastLivenessAt: T0 });
    const r = transition(m, { type: 'MISSED_CHECK_IN', at: daysAfter(T0, 3) });
    expect(r.ok).toBe(false);
  });

  it('MARK_STALLED moves VERIFYING to STALLED and alerts every channel', () => {
    const m = machineIn('VERIFYING');
    const r = transition(m, { type: 'MARK_STALLED', at: daysAfter(T0, 40), operatorId: 'op-1' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.machine.state).toBe('STALLED');
    expect(r.effects).toContain('ALERT_ALL_CHANNELS');
  });

  it('an admin freeze blocks START_HOLD but a later unfreeze restores it', () => {
    let m = machineIn('VERIFYING');
    const frozen = transition(m, { type: 'ADMIN_FREEZE', at: T0, adminId: 'admin-1' });
    expect(frozen.ok).toBe(true);
    if (!frozen.ok) return;
    m = frozen.machine;
    expect(m.adminFrozen).toBe(true);

    const blocked = transition(m, { type: 'START_HOLD', at: daysAfter(T0, 31), operatorId: 'op-1' });
    expect(blocked.ok).toBe(false);

    const thawed = transition(m, { type: 'ADMIN_UNFREEZE', at: T0, adminId: 'admin-1' });
    expect(thawed.ok).toBe(true);
    if (!thawed.ok) return;
    const started = transition(thawed.machine, {
      type: 'START_HOLD',
      at: daysAfter(T0, 31),
      operatorId: 'op-1',
    });
    expect(started.ok).toBe(true);
  });

  it('setting a dependency unhealthy then healthy gates VERIFYING entry', () => {
    let m = machineIn('NUDGE');
    const unhealthy = transition(m, { type: 'SET_DEPENDENCY_HEALTH', at: T0, ok: false });
    expect(unhealthy.ok).toBe(true);
    if (!unhealthy.ok) return;
    m = unhealthy.machine;
    expect(transition(m, { type: 'REACH_VERIFYING', at: daysAfter(T0, 30) }).ok).toBe(false);

    const healthy = transition(m, { type: 'SET_DEPENDENCY_HEALTH', at: T0, ok: true });
    expect(healthy.ok).toBe(true);
    if (!healthy.ok) return;
    expect(transition(healthy.machine, { type: 'REACH_VERIFYING', at: daysAfter(T0, 30) }).ok).toBe(true);
  });

  it('rejects a nonsense transition (START_HOLD from ACTIVE) and leaves state unchanged', () => {
    const m = machineIn('ACTIVE');
    const r = transition(m, { type: 'START_HOLD', at: T0, operatorId: 'op-1' });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.machine.state).toBe('ACTIVE');
  });

  it('does not mutate the input machine (pure)', () => {
    const m = machineIn('NUDGE');
    const snapshot = JSON.stringify(m);
    transition(m, { type: 'CHECK_IN', at: daysAfter(T0, 10) });
    expect(JSON.stringify(m)).toBe(snapshot);
  });
});
