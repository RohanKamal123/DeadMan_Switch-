// Key-value backends for the snapshot STATE repositories (Phase D). Distinct
// from the audit sinks: state repositories hold the CURRENT value of things
// (overwritten as they change), whereas the audit store is append-only history.
// Keeping the two backends separate keeps that distinction structural — a
// repository has no way to append to the trail, and the trail has no way to
// overwrite.
//
// The contract is a small string→string map. Repositories serialize typed
// records to JSON on top of it, so the same repository code runs over an
// in-memory map (tests) or a JSON file (production, survives a restart).

import * as fs from 'node:fs';
import * as path from 'node:path';

export interface KeyValueStore {
  get(key: string): string | undefined;
  set(key: string, value: string): void;
  delete(key: string): void;
  keys(): readonly string[];
}

export class InMemoryKeyValueStore implements KeyValueStore {
  private readonly map = new Map<string, string>();

  get(key: string): string | undefined {
    return this.map.get(key);
  }
  set(key: string, value: string): void {
    this.map.set(key, value);
  }
  delete(key: string): void {
    this.map.delete(key);
  }
  keys(): readonly string[] {
    return Array.from(this.map.keys());
  }
}

/**
 * A single-JSON-file store. The whole map is loaded on construction and
 * rewritten on every mutation — simple and correct at pilot scale (DECISIONS.md
 * 7.1). A fresh process over the same file reloads all state, so accounts,
 * machine snapshots, payloads, case files, and delivery records survive a
 * restart.
 */
export class FileKeyValueStore implements KeyValueStore {
  private readonly map: Map<string, string>;

  constructor(private readonly filePath: string) {
    this.map = new Map(Object.entries(this.load()));
  }

  private load(): Record<string, string> {
    if (!fs.existsSync(this.filePath)) return {};
    const raw = fs.readFileSync(this.filePath, 'utf8');
    if (raw.trim().length === 0) return {};
    return JSON.parse(raw) as Record<string, string>;
  }

  private flush(): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(Object.fromEntries(this.map), null, 2), 'utf8');
  }

  get(key: string): string | undefined {
    return this.map.get(key);
  }
  set(key: string, value: string): void {
    this.map.set(key, value);
    this.flush();
  }
  delete(key: string): void {
    if (this.map.delete(key)) this.flush();
  }
  keys(): readonly string[] {
    return Array.from(this.map.keys());
  }
}
