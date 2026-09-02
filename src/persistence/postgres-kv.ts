// Production persistence — a Postgres-backed KeyValueStore for multi-node
// deployments.
//
// Postgres' driver is asynchronous, but the repositories speak the synchronous
// KeyValueStore contract, so this store is a write-through cache: it loads the
// whole namespace into memory at boot (await `init()`), serves reads from the
// cache synchronously, and on every set/delete updates the cache AND enqueues a
// durable write on a serial async queue. Callers await `flush()` at a safe point
// (request end, shutdown) to guarantee the write landed; a write error is
// surfaced through `onError` rather than swallowed. This is the well-worn
// cache-over-Postgres pattern, and it matches the durability the JSON-file store
// gave (whole state in memory, persisted out of band) while adding multi-node
// storage. For strict per-write durability on a single node, prefer the SQLite
// driver (sqlite.ts).
//
// The store depends on an async `SqlExecutor` PORT, never on `pg`; the binding
// (createPgExecutor) is the only place `pg` is required.

import type { KeyValueStore } from './kv';

export interface SqlExecutor {
  exec(sql: string): Promise<void>;
  run(sql: string, params: readonly unknown[]): Promise<void>;
  all(sql: string, params: readonly unknown[]): Promise<Record<string, unknown>[]>;
}

const SCHEMA = 'CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL)';
const Q_SET = 'INSERT INTO kv (k, v) VALUES ($1, $2) ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v';
const Q_DEL = 'DELETE FROM kv WHERE k = $1';
const Q_ALL = 'SELECT k, v FROM kv';

export interface PostgresKeyValueStoreOptions {
  readonly executor: SqlExecutor;
  /** Called if a durable write ever fails. Default: rethrow on the next flush. */
  readonly onError?: (error: unknown) => void;
}

export class PostgresKeyValueStore implements KeyValueStore {
  private readonly executor: SqlExecutor;
  private readonly cache = new Map<string, string>();
  private queue: Promise<void> = Promise.resolve();
  private lastError: unknown;
  private readonly onError?: (error: unknown) => void;

  constructor(options: PostgresKeyValueStoreOptions) {
    this.executor = options.executor;
    if (options.onError !== undefined) this.onError = options.onError;
  }

  /** Create the table and warm the cache. Await before serving traffic. */
  async init(): Promise<void> {
    await this.executor.exec(SCHEMA);
    const rows = await this.executor.all(Q_ALL, []);
    this.cache.clear();
    for (const row of rows) this.cache.set(String(row['k']), String(row['v']));
  }

  private enqueue(work: () => Promise<void>): void {
    this.queue = this.queue.then(work).catch((error: unknown) => {
      this.lastError = error;
      if (this.onError !== undefined) this.onError(error);
    });
  }

  /** Await all pending durable writes. Rejects if any write since the last flush failed. */
  async flush(): Promise<void> {
    await this.queue;
    if (this.lastError !== undefined) {
      const error = this.lastError;
      this.lastError = undefined;
      throw error;
    }
  }

  get(key: string): string | undefined {
    return this.cache.get(key);
  }

  set(key: string, value: string): void {
    this.cache.set(key, value);
    this.enqueue(() => this.executor.run(Q_SET, [key, value]));
  }

  delete(key: string): void {
    if (this.cache.delete(key)) {
      this.enqueue(() => this.executor.run(Q_DEL, [key]));
    }
  }

  keys(): readonly string[] {
    return Array.from(this.cache.keys());
  }
}

/**
 * The `pg` binding — the only place the module is required. Returns an executor
 * over a connection pool. Install `pg` and set LV_DATABASE_URL to use it.
 *
 *   npm install pg
 *   LV_STATE_BACKEND=postgres  LV_DATABASE_URL=postgres://user:pass@host/db
 */
export function createPgExecutor(connectionString: string): SqlExecutor {
  let Pool: new (config: { connectionString: string }) => {
    query(text: string, params?: readonly unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
  };
  try {
    const req = eval('require') as (id: string) => unknown;
    Pool = (req('pg') as { Pool: typeof Pool }).Pool;
  } catch {
    throw new Error('pg is not installed. Run `npm install pg` to use LV_STATE_BACKEND=postgres.');
  }
  const pool = new Pool({ connectionString });
  return {
    exec: async (sql: string): Promise<void> => {
      await pool.query(sql);
    },
    run: async (sql: string, params: readonly unknown[]): Promise<void> => {
      await pool.query(sql, params);
    },
    all: async (sql: string, params: readonly unknown[]): Promise<Record<string, unknown>[]> => {
      const { rows } = await pool.query(sql, params);
      return rows;
    },
  };
}
