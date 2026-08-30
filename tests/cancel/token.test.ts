// The no-login, 24/7 self-serve cancel link (DECISIONS.md 6.1; UX_SPEC.md §2).
// A signed single-purpose token; its whole job is to let a living user stop
// everything without a login. Cancelling is always the safe direction.

import {
  issueCancelToken,
  verifyCancelToken,
  redeemCancel,
} from '../../src/cancel/token';
import { Machine } from '../../src/domain/machine';
import { T0, daysAfter, machineIn } from '../support/factory';

const SECRET = 'test-signing-secret';

describe('cancel token', () => {
  it('round-trips a valid token to its account id', () => {
    const token = issueCancelToken('acct-1', T0, SECRET);
    const r = verifyCancelToken(token, SECRET, daysAfter(T0, 5));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.accountId).toBe('acct-1');
  });

  it('rejects a tampered payload', () => {
    const token = issueCancelToken('acct-1', T0, SECRET);
    const [payload, sig] = token.split('.');
    const forged = `${Buffer.from('{"accountId":"acct-2","purpose":"cancel","issuedAt":0}').toString('base64url')}.${sig}`;
    expect(verifyCancelToken(forged, SECRET, T0).ok).toBe(false);
    expect(payload).toBeDefined();
  });

  it('rejects a token signed with a different secret', () => {
    const token = issueCancelToken('acct-1', T0, SECRET);
    expect(verifyCancelToken(token, 'wrong-secret', T0).ok).toBe(false);
  });

  it('rejects a malformed token without dead-ending (fail-safe reason)', () => {
    const r = verifyCancelToken('not-a-token', SECRET, T0);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBeTruthy();
  });

  it('redeeming a valid token cancels the machine from any state', () => {
    const machine = new Machine({ now: T0 });
    machine.context = machineIn('HOLD', { holdStartedAt: T0 });
    const token = issueCancelToken('acct-1', T0, SECRET);
    const r = redeemCancel(token, SECRET, daysAfter(T0, 10), machine);
    expect(r.ok).toBe(true);
    expect(machine.state).toBe('CANCELLED');
  });

  it('a bad token never advances or mutates the machine', () => {
    const machine = new Machine({ now: T0 });
    machine.context = machineIn('HOLD', { holdStartedAt: T0 });
    const r = redeemCancel('garbage', SECRET, daysAfter(T0, 10), machine);
    expect(r.ok).toBe(false);
    expect(machine.state).toBe('HOLD');
  });
});
