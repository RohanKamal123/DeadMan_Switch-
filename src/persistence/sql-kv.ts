// Production persistence — a SQL-backed KeyValueStore.
//
// The repositories speak the small synchronous string→string KeyValueStore
// contract (kv.ts). The single-JSON-file store was "simple and correct at pilot
// scale" (DECISIONS.md 7.1); this is the step past it. It keeps the exact same
// synchronous contract — so nothing above persistence changes — while giving
// per-write durability through a real database: every set/delete is a committed
// SQL statement, not a rewrite of one giant file.
//
// The store depends on a `SyncSqlDriver` PORT, never on a database library, so
// no driver SDK escapes its binding file (sqlite.ts) — the same rule the vendor
// adapters follow. The port's four methods are exactly the shape of a
// synchronous embedded driver (better-sqlite3), and a faithful in-memory Fake
// lives here so the store's SQL logic is exercised without a native module.

import type { KeyValueStore } from './kv';

/** A minimal synchronous SQL executor. Mirrors better-sqlite3's prepare/exec API. */
export interface SyncSqlDriver {
  /** Run a schema statement (no params, no result). */
  exec(sql: string): void;
  /** Run a write statement with positional params. */
  run(sql: string, params: readonly unknown[]): void;
  /** First row of a query, or undefined. */
  get(sql: string, params: readonly unknown[]): Record<string, unknown> | undefined;
  /** All rows of a query. */
  all(sql: string, params: readonly unknown[]): Record<string, unknown>[];
}

const SCHEMA = 'CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL)';
const Q_GET = 'SELECT v FROM kv WHERE k = ?';
const Q_SET = 'INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v';
const Q_DEL = 'DELETE FROM kv WHERE k = ?';
const Q_KEYS = 'SELECT k FROM kv';

/**
 * A KeyValueStore over a synchronous SQL driver. Per-write durable: `set` and
 * `delete` commit immediately, so a fresh process over the same database reloads
 * every snapshot — accounts, machine state, payloads, subscriptions, memorials.
 */
export class SqlKeyValueStore implements KeyValueStore {
  constructor(private readonly driver: SyncSqlDriver) {
    this.driver.exec(SCHEMA);
  }

  get(key: string): string | undefined {
    const row = this.driver.get(Q_GET, [key]);
    if (row === undefined) return undefined;
    const v = row['v'];
    return typeof v === 'string' ? v : undefined;
  }

  set(key: string, value: string): void {
    this.driver.run(Q_SET, [key, value]);
  }

  delete(key: string): void {
    this.driver.run(Q_DEL, [key]);
  }

  keys(): readonly string[] {
    return this.driver.all(Q_KEYS, []).map((r) => String(r['k']));
  }
}

/**
 * A faithful in-memory implementation of the driver for tests and local dev. It
 * recognises exactly the store's fixed statement set and applies them over a
 * Map, so the store's SQL path runs identically to production.
 */
export class FakeSyncSqlDriver implements SyncSqlDriver {
  private readonly rows = new Map<string, string>();

  exec(_sql: string): void {
    // Only the CREATE TABLE schema statement is exec'd; nothing to do in memory.
  }

  run(sql: string, params: readonly unknown[]): void {
    if (sql === Q_SET) {
      this.rows.set(String(params[0]), String(params[1]));
    } else if (sql === Q_DEL) {
      this.rows.delete(String(params[0]));
    } else {
      throw new Error(`FakeSyncSqlDriver: unrecognised write ${sql}`);
    }
  }

  get(sql: string, params: readonly unknown[]): Record<string, unknown> | undefined {
    if (sql === Q_GET) {
      const v = this.rows.get(String(params[0]));
      return v === undefined ? undefined : { v };
    }
    throw new Error(`FakeSyncSqlDriver: unrecognised get ${sql}`);
  }

  all(sql: string, _params: readonly unknown[]): Record<string, unknown>[] {
    if (sql === Q_KEYS) return Array.from(this.rows.keys()).map((k) => ({ k }));
    throw new Error(`FakeSyncSqlDriver: unrecognised all ${sql}`);
  }
}
