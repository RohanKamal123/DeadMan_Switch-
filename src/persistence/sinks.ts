// Append-only byte sinks for the durable audit store (Phase D). A sink is the
// low-level durability boundary: it stores opaque lines and reads them back in
// insertion order. It knows nothing about hashing, chaining, or audit shape —
// that lives in `audit-store.ts` — so the tamper-evidence logic is identical
// whether the bytes rest in memory (tests) or on disk (production).
//
// The contract is deliberately narrow: append and read. There is no update,
// delete, or truncate. The store above enforces the append-only invariant;
// these sinks simply have no method that would break it (the in-memory
// `overwrite` is a TEST-ONLY tampering hook, never used by production code).

import * as fs from 'node:fs';
import * as path from 'node:path';

export interface AppendOnlySink {
  /** Persist one opaque line (no embedded newlines). */
  append(line: string): void;
  /** Every line ever appended, in insertion order. */
  read(): readonly string[];
}

export class InMemoryAppendOnlySink implements AppendOnlySink {
  private readonly lines: string[] = [];

  append(line: string): void {
    this.lines.push(line);
  }

  read(): readonly string[] {
    return this.lines.slice();
  }

  /**
   * TEST-ONLY. Replace the stored lines to simulate on-disk tampering,
   * deletion, or reordering. Production code never calls this — the interface
   * does not expose it.
   */
  overwrite(lines: readonly string[]): void {
    this.lines.length = 0;
    this.lines.push(...lines);
  }
}

/**
 * A file-backed sink: one JSON record per line (JSONL). Appends are durable
 * (`fs.appendFileSync` flushes to the OS), and the whole file is read back on
 * load so a fresh process rebuilds and re-verifies the chain. The parent
 * directory is created on first write.
 */
export class FileAppendOnlySink implements AppendOnlySink {
  constructor(private readonly filePath: string) {}

  append(line: string): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.appendFileSync(this.filePath, line + '\n', 'utf8');
  }

  read(): readonly string[] {
    if (!fs.existsSync(this.filePath)) return [];
    const raw = fs.readFileSync(this.filePath, 'utf8');
    if (raw.length === 0) return [];
    // A trailing newline yields one empty tail element; drop empties.
    return raw.split('\n').filter((l) => l.length > 0);
  }
}
