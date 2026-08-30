// Quorum counting, including the self-dealing guard (DECISIONS.md 10.2 / 10.3).

import { computeQuorum } from '../src/domain/quorum';
import type { Confirmation } from '../src/domain/quorum';

const at = 1_700_000_000_000;
function conf(contactId: string, group: Confirmation['group']): Confirmation {
  return { contactId, group, recordingOperatorId: 'op-1', at };
}

describe('computeQuorum', () => {
  it('is met with three distinct groups', () => {
    const r = computeQuorum([conf('a', 'family'), conf('b', 'friend'), conf('c', 'colleague')]);
    expect(r.met).toBe(true);
    expect(r.distinctGroups).toBe(3);
  });

  it('is not met with two distinct groups', () => {
    const r = computeQuorum([conf('a', 'family'), conf('b', 'family'), conf('c', 'friend')]);
    expect(r.met).toBe(false);
    expect(r.distinctGroups).toBe(2);
  });

  it('collapses duplicate contacts (several phones) into one group', () => {
    const r = computeQuorum([conf('x', 'family'), conf('x', 'family'), conf('x', 'family')]);
    expect(r.met).toBe(false);
    expect(r.distinctGroups).toBe(1);
  });

  it('is met with all four groups', () => {
    const r = computeQuorum([
      conf('a', 'family'),
      conf('b', 'friend'),
      conf('c', 'colleague'),
      conf('d', 'other'),
    ]);
    expect(r.met).toBe(true);
    expect(r.distinctGroups).toBe(4);
  });

  it('self-dealing guard: excludes a recipient-confirmer, dropping below quorum', () => {
    // Three groups, but one confirmer ('b') is also the release recipient.
    const confirmations = [conf('a', 'family'), conf('b', 'friend'), conf('c', 'colleague')];
    const withB = computeQuorum(confirmations);
    expect(withB.met).toBe(true);
    const excludingB = computeQuorum(confirmations, { excludeContactId: 'b' });
    expect(excludingB.met).toBe(false); // only family + colleague remain
    expect(excludingB.distinctGroups).toBe(2);
  });

  it('self-dealing guard: quorum survives exclusion when a spare group exists', () => {
    const confirmations = [
      conf('a', 'family'),
      conf('b', 'friend'),
      conf('c', 'colleague'),
      conf('recipient', 'other'),
    ];
    const excluding = computeQuorum(confirmations, { excludeContactId: 'recipient' });
    expect(excluding.met).toBe(true);
    expect(excluding.distinctGroups).toBe(3);
  });

  it('reports the counted groups', () => {
    const r = computeQuorum([conf('a', 'family'), conf('b', 'friend')]);
    expect([...r.groups].sort()).toEqual(['family', 'friend']);
  });
});
