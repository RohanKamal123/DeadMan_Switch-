// FileKeyValueStore (Phase D). The state file holds the cancel + machine
// snapshots, so writes are ATOMIC (temp + fsync + rename) — a crash mid-write can
// never truncate it — and a corrupt file FAILS LOUD rather than silently starting
// from empty state.

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { FileKeyValueStore } from '../../src/persistence/kv';

function tmpFile(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lv-kv-'));
  return path.join(dir, 'state.json');
}

describe('FileKeyValueStore', () => {
  it('persists values across a fresh instance (survives a restart)', () => {
    const file = tmpFile();
    const a = new FileKeyValueStore(file);
    a.set('machine:acct-1', '{"state":"ACTIVE"}');
    a.set('machine:acct-2', '{"state":"HOLD"}');

    const b = new FileKeyValueStore(file); // a "restart" over the same file
    expect(b.get('machine:acct-1')).toBe('{"state":"ACTIVE"}');
    expect(b.get('machine:acct-2')).toBe('{"state":"HOLD"}');
    expect([...b.keys()].sort()).toEqual(['machine:acct-1', 'machine:acct-2']);
  });

  it('deletes persist, and an empty store loads cleanly', () => {
    const file = tmpFile();
    const a = new FileKeyValueStore(file);
    a.set('k', 'v');
    a.delete('k');
    expect(new FileKeyValueStore(file).get('k')).toBeUndefined();
  });

  it('leaves no temp files behind after writes (atomic rename)', () => {
    const file = tmpFile();
    const store = new FileKeyValueStore(file);
    for (let i = 0; i < 20; i++) store.set(`k${i}`, `v${i}`);
    const dir = path.dirname(file);
    const stray = fs.readdirSync(dir).filter((f) => f.endsWith('.tmp'));
    expect(stray).toEqual([]);
    // The final file is whole, valid JSON with every key.
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, string>;
    expect(Object.keys(parsed)).toHaveLength(20);
    expect(parsed['k19']).toBe('v19');
  });

  it('refuses to start from a corrupt state file instead of dropping all state', () => {
    const file = tmpFile();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '{ this is not json', 'utf8');
    expect(() => new FileKeyValueStore(file)).toThrow(/not valid JSON|restore it from a backup/);
  });

  it('treats a missing or empty file as empty state', () => {
    const file = tmpFile();
    expect(new FileKeyValueStore(file).keys()).toEqual([]); // missing
    fs.writeFileSync(file, '   \n', 'utf8');
    expect(new FileKeyValueStore(file).keys()).toEqual([]); // whitespace-only
  });
});
