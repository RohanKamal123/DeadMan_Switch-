// Invariant 3: no content is released before the HOLD window has FULLY
// elapsed (PRODUCT_SPEC.md invariant 3 / §HOLD / §PRIVATE_RELEASE;
// DECISIONS.md 0.1). The timer is deterministic code; no operator, admin, or
// "verified" status may skip or shorten it.

import { transition } from '../../src/domain/transition';
import {
  HOLD_LENIENT_DAYS,
  HOLD_STRICT_DAYS,
  PUBLIC_RELEASE_DELAY_DAYS,
} from '../../src/domain/config';
import { machineIn, T0, daysAfter } from '../support/factory';

describe('invariant 3 — no release before HOLD fully elapses', () => {
  it('rejects private release one day before the lenient window closes', () => {
    const m = machineIn('HOLD', { evidenceMode: 'lenient', holdStartedAt: T0 });
    const r = transition(m, {
      type: 'TRIGGER_PRIVATE_RELEASE',
      at: daysAfter(T0, HOLD_LENIENT_DAYS - 1),
      operatorId: 'op-1',
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.machine.state).toBe('HOLD');
  });

  it('rejects private release one millisecond before the window closes', () => {
    const m = machineIn('HOLD', { evidenceMode: 'lenient', holdStartedAt: T0 });
    const r = transition(m, {
      type: 'TRIGGER_PRIVATE_RELEASE',
      at: daysAfter(T0, HOLD_LENIENT_DAYS) - 1,
      operatorId: 'op-1',
    });
    expect(r.ok).toBe(false);
  });

  it('allows private release exactly at the lenient window boundary', () => {
    const m = machineIn('HOLD', { evidenceMode: 'lenient', holdStartedAt: T0 });
    const r = transition(m, {
      type: 'TRIGGER_PRIVATE_RELEASE',
      at: daysAfter(T0, HOLD_LENIENT_DAYS),
      operatorId: 'op-1',
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.machine.state).toBe('PRIVATE_RELEASE');
    expect(r.effects).toContain('DELIVER_PRIVATE');
  });

  it('strict mode blocks release after 21 days without a death certificate', () => {
    const m = machineIn('HOLD', {
      evidenceMode: 'strict',
      holdStartedAt: T0,
      deathCertificateUploaded: false,
    });
    const r = transition(m, {
      type: 'TRIGGER_PRIVATE_RELEASE',
      at: daysAfter(T0, HOLD_STRICT_DAYS + 100),
      operatorId: 'op-1',
    });
    expect(r.ok).toBe(false);
  });

  it('strict mode releases at 21 days once a certificate is uploaded', () => {
    const m = machineIn('HOLD', {
      evidenceMode: 'strict',
      holdStartedAt: T0,
      deathCertificateUploaded: true,
    });
    const r = transition(m, {
      type: 'TRIGGER_PRIVATE_RELEASE',
      at: daysAfter(T0, HOLD_STRICT_DAYS),
      operatorId: 'op-1',
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.machine.state).toBe('PRIVATE_RELEASE');
  });

  it('public release is blocked before its own 14-day window', () => {
    const m = machineIn('PRIVATE_RELEASE', {
      publicReleaseEnabled: true,
      privateReleasedAt: T0,
    });
    const early = transition(m, {
      type: 'TRIGGER_PUBLIC_RELEASE',
      at: daysAfter(T0, PUBLIC_RELEASE_DELAY_DAYS - 1),
      operatorId: 'op-1',
    });
    expect(early.ok).toBe(false);

    const onTime = transition(m, {
      type: 'TRIGGER_PUBLIC_RELEASE',
      at: daysAfter(T0, PUBLIC_RELEASE_DELAY_DAYS),
      operatorId: 'op-1',
    });
    expect(onTime.ok).toBe(true);
    if (!onTime.ok) return;
    expect(onTime.machine.state).toBe('PUBLIC_RELEASE');
  });

  it('public release requires the user to have enabled it', () => {
    const m = machineIn('PRIVATE_RELEASE', {
      publicReleaseEnabled: false,
      privateReleasedAt: T0,
    });
    const r = transition(m, {
      type: 'TRIGGER_PUBLIC_RELEASE',
      at: daysAfter(T0, PUBLIC_RELEASE_DELAY_DAYS),
      operatorId: 'op-1',
    });
    expect(r.ok).toBe(false);
  });

  it('no non-release event from HOLD can produce PRIVATE_RELEASE', () => {
    const m = machineIn('HOLD', { holdStartedAt: T0 });
    const at = daysAfter(T0, HOLD_LENIENT_DAYS + 5);
    const events = [
      { type: 'UPLOAD_DEATH_CERTIFICATE' as const, at, operatorId: 'op-1' },
      { type: 'MARK_STALLED' as const, at, operatorId: 'op-1' },
      { type: 'CHECK_IN' as const, at },
    ];
    for (const ev of events) {
      const r = transition(m, ev);
      if (r.ok) expect(r.machine.state).not.toBe('PRIVATE_RELEASE');
    }
  });
});
