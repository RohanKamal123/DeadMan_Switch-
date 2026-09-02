import { SqlKeyValueStore, FakeSyncSqlDriver, type KeyValueStore } from '../../src/persistence';

// The SQL-backed store must satisfy the same contract as the in-memory and file
// stores. Run the shared contract against it.
function contract(make: () => KeyValueStore): void {
  it('returns undefined for a missing key', () => {
    expect(make().get('nope')).toBeUndefined();
  });
  it('round-trips a value', () => {
    const s = make();
    s.set('k', 'v');
    expect(s.get('k')).toBe('v');
  });
  it('overwrites in place', () => {
    const s = make();
    s.set('k', 'a');
    s.set('k', 'b');
    expect(s.get('k')).toBe('b');
    expect(s.keys()).toEqual(['k']);
  });
  it('deletes', () => {
    const s = make();
    s.set('k', 'v');
    s.delete('k');
    expect(s.get('k')).toBeUndefined();
    expect(s.keys()).not.toContain('k');
  });
  it('lists keys', () => {
    const s = make();
    s.set('a', '1');
    s.set('b', '2');
    expect([...s.keys()].sort()).toEqual(['a', 'b']);
  });
}

describe('SqlKeyValueStore over the fake sync driver', () => {
  contract(() => new SqlKeyValueStore(new FakeSyncSqlDriver()));

  it('persists across a fresh store over the same driver (restart durability)', () => {
    const driver = new FakeSyncSqlDriver();
    const first = new SqlKeyValueStore(driver);
    first.set('account:1', '{"id":"1"}');
    const second = new SqlKeyValueStore(driver);
    expect(second.get('account:1')).toBe('{"id":"1"}');
  });
});
