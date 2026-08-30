// Invariant 4: no two of the three required quorum confirmations may come from
// the same trustee group. Enforced at the START_HOLD gate (PRODUCT_SPEC.md §4;
// DECISIONS.md 10.2). Defeats the "one person, several phones" attack.

import { transition } from '../../src/domain/transition';
import type { Confirmation } from '../../src/domain/quorum';
import { machineIn, T0, daysAfter } from '../support/factory';

const at = daysAfter(T0, 31);

function conf(contactId: string, group: Confirmation['group']): Confirmation {
  return { contactId, group, recordingOperatorId: 'op-1', at };
}

describe('invariant 4 — quorum group diversity', () => {
  it('blocks START_HOLD with three confirmations from only two groups', () => {
    const m = machineIn('VERIFYING', {
      confirmations: [
        conf('a', 'family'),
        conf('b', 'family'),
        conf('c', 'friend'),
      ],
    });
    const r = transition(m, { type: 'START_HOLD', at, operatorId: 'op-1' });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.machine.state).toBe('VERIFYING');
  });

  it('allows START_HOLD with three distinct groups', () => {
    const m = machineIn('VERIFYING', {
      confirmations: [
        conf('a', 'family'),
        conf('b', 'friend'),
        conf('c', 'colleague'),
      ],
    });
    const r = transition(m, { type: 'START_HOLD', at, operatorId: 'op-1' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.machine.state).toBe('HOLD');
    expect(r.effects).toEqual(
      expect.arrayContaining(['PING_CANCEL_ALL_CHANNELS', 'NOTIFY_CONFIRMERS_HOLD']),
    );
  });

  it('treats one person with several phones (same contact) as a single group', () => {
    const m = machineIn('VERIFYING', {
      confirmations: [
        conf('same-person', 'family'),
        conf('same-person', 'family'),
        conf('same-person', 'family'),
      ],
    });
    const r = transition(m, { type: 'START_HOLD', at, operatorId: 'op-1' });
    expect(r.ok).toBe(false);
  });

  it('blocks START_HOLD with fewer than three confirmations', () => {
    const m = machineIn('VERIFYING', {
      confirmations: [conf('a', 'family'), conf('b', 'friend')],
    });
    const r = transition(m, { type: 'START_HOLD', at, operatorId: 'op-1' });
    expect(r.ok).toBe(false);
  });

  it('reopens VERIFYING when a HOLD withdrawal drops below quorum (veto path 2)', () => {
    const m = machineIn('HOLD', {
      holdStartedAt: at,
      confirmations: [
        conf('a', 'family'),
        conf('b', 'friend'),
        conf('c', 'colleague'),
      ],
    });
    const r = transition(m, {
      type: 'WITHDRAW_CONFIRMATION',
      at: daysAfter(T0, 35),
      contactId: 'c',
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.machine.state).toBe('VERIFYING');
    expect(r.machine.holdStartedAt).toBeNull();
  });

  it('keeps HOLD when a withdrawal still leaves quorum intact', () => {
    const m = machineIn('HOLD', {
      holdStartedAt: at,
      confirmations: [
        conf('a', 'family'),
        conf('b', 'friend'),
        conf('c', 'colleague'),
        conf('d', 'other'),
      ],
    });
    const r = transition(m, {
      type: 'WITHDRAW_CONFIRMATION',
      at: daysAfter(T0, 35),
      contactId: 'd',
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.machine.state).toBe('HOLD');
  });
});
