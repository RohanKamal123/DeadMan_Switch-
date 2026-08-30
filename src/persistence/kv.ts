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
 *
 * WRITES ARE ATOMIC and durable: each flush writes a fresh temp file in the same
 * directory, fsyncs it, then `rename`s it over the target — a POSIX rename is
 * atomic, so a crash mid-write can never leave a truncated or half-written state
 * file. The target is always either the whole previous version or the whole new
 * one. This matters here more than most places: the state file holds the cancel
 * and machine snapshots, and a corrupt file on the next boot would be state loss.
 *
 * LOADING FAILS LOUD: a present-but-unparseable file throws rather than starting
 * from empty state — silently dropping every account is not a safe default, and
 * an operator must restore from backup instead of the process pretending all is
 * well. (Atomic writes mean this should only ever happen to a file corrupted
 * out-of-band.)
 */
export class FileKeyValueStore implements KeyValueStore {
  private readonly map: Map<string, string>;
  private tmpSeq = 0;

  constructor(private readonly filePath: string) {
    this.map = new Map(Object.entries(this.load()));
  }

  private load(): Record<string, string> {
    if (!fs.existsSync(this.filePath)) return {};
    const raw = fs.readFileSync(this.filePath, 'utf8');
    if (raw.trim().length === 0) return {};
    try {
      return JSON.parse(raw) as Record<string, string>;
    } catch {
      throw new Error(
        `state file at ${this.filePath} is present but not valid JSON; refusing to start with empty state — restore it from a backup`,
      );
    }
  }

  private flush(): void {
    const dir = path.dirname(this.filePath);
    fs.mkdirSync(dir, { recursive: true });
    const data = JSON.stringify(Object.fromEntries(this.map), null, 2);
    // Unique temp name in the SAME directory (rename is only atomic within a
    // filesystem). Write → fsync → atomic rename over the target.
    const tmp = path.join(dir, `.${path.basename(this.filePath)}.${process.pid}.${++this.tmpSeq}.tmp`);
    const fd = fs.openSync(tmp, 'w');
    try {
      fs.writeSync(fd, data);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    try {
      fs.renameSync(tmp, this.filePath);
    } catch (err) {
      // Never leave the temp file lying around if the rename failed.
      try {
        fs.unlinkSync(tmp);
      } catch {
        // best-effort cleanup
      }
      throw err;
    }
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
