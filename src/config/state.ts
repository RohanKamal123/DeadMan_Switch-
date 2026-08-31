// Deployment state + audit backends, shared by the main bootstrap and the
// isolated cancel bootstrap (F1.5). This module depends ONLY on the persistence
// layer — never on a vendor adapter, crypto, or billing — so the cancel process
// can import it without pulling any of that into its failure domain (F1.4/F1.2).

import {
  FileKeyValueStore,
  InMemoryKeyValueStore,
  PostgresKeyValueStore,
  SqlKeyValueStore,
  createPgExecutor,
  createSqliteDriver,
  HashChainedAuditStore,
  FileAppendOnlySink,
  InMemoryAppendOnlySink,
  type KeyValueStore,
} from '../persistence';
import type { AuditSink } from '../domain/audit';
import type { AuditSinkFactory } from '../runtime';

function env(name: string, fallback = ''): string {
  return process.env[name] ?? fallback;
}

/** Build the state KeyValueStore from LV_STATE_BACKEND. Postgres is awaited (init). */
export async function stateBackend(): Promise<KeyValueStore> {
  const backend = env('LV_STATE_BACKEND', 'file');
  switch (backend) {
    case 'memory':
      return new InMemoryKeyValueStore();
    case 'file':
      return new FileKeyValueStore(env('LV_STATE_FILE', './data/state.json'));
    case 'sqlite':
      return new SqlKeyValueStore(createSqliteDriver(env('LV_SQLITE_PATH', './data/state.db')));
    case 'postgres': {
      const store = new PostgresKeyValueStore({ executor: createPgExecutor(env('LV_DATABASE_URL')) });
      await store.init();
      return store;
    }
    default:
      throw new Error(`unknown LV_STATE_BACKEND: ${backend}`);
  }
}

/** A per-account durable audit sink factory (invariant 7), file-backed when LV_AUDIT_DIR is set. */
export function auditFactory(): AuditSinkFactory {
  const dir = env('LV_AUDIT_DIR');
  const sinks = new Map<string, AuditSink>();
  const make =
    dir === ''
      ? (): AuditSink => new HashChainedAuditStore(new InMemoryAppendOnlySink()) as AuditSink
      : (id: string): AuditSink => new HashChainedAuditStore(new FileAppendOnlySink(`${dir}/${id}.log`)) as AuditSink;
  return (id: string): AuditSink => {
    let s = sinks.get(id);
    if (s === undefined) {
      s = make(id);
      sinks.set(id, s);
    }
    return s;
  };
}
