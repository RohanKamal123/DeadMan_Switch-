// The SQLite binding for the SQL key-value store — the ONLY place the
// better-sqlite3 module is touched. It is lazy-required so the codebase compiles
// and its tests run with no native module installed; a deployment that wants the
// recommended per-write-durable production store installs `better-sqlite3` and
// points LV_STATE_BACKEND at a file.
//
//   npm install better-sqlite3
//   LV_STATE_BACKEND=sqlite  LV_SQLITE_PATH=/var/lib/legacy-vault/state.db
//
// better-sqlite3 is synchronous, so it satisfies the KeyValueStore contract
// exactly, with real transactional durability on every write.

import type { SyncSqlDriver } from './sql-kv';

interface BetterSqliteStatement {
  run(...params: unknown[]): unknown;
  get(...params: unknown[]): Record<string, unknown> | undefined;
  all(...params: unknown[]): Record<string, unknown>[];
}
interface BetterSqliteDatabase {
  prepare(sql: string): BetterSqliteStatement;
  exec(sql: string): void;
  pragma(source: string): unknown;
}

/**
 * Build a synchronous SQL driver backed by better-sqlite3 at `filePath`. Throws
 * a clear error if the module is not installed. WAL mode is enabled for
 * concurrent-reader durability.
 */
export function createSqliteDriver(filePath: string): SyncSqlDriver {
  let Database: new (path: string) => BetterSqliteDatabase;
  try {
    // Lazy, indirect require so bundlers/typecheck don't hard-depend on it.
    const req = eval('require') as (id: string) => unknown;
    Database = req('better-sqlite3') as new (path: string) => BetterSqliteDatabase;
  } catch {
    throw new Error(
      'better-sqlite3 is not installed. Run `npm install better-sqlite3` to use LV_STATE_BACKEND=sqlite.',
    );
  }
  const db = new Database(filePath);
  db.pragma('journal_mode = WAL');
  return {
    exec: (sql: string): void => db.exec(sql),
    run: (sql: string, params: readonly unknown[]): void => {
      db.prepare(sql).run(...params);
    },
    get: (sql: string, params: readonly unknown[]): Record<string, unknown> | undefined =>
      db.prepare(sql).get(...params),
    all: (sql: string, params: readonly unknown[]): Record<string, unknown>[] => db.prepare(sql).all(...params),
  };
}
