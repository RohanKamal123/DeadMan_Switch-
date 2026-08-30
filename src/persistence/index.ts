// Phase D — durability & persistence (DECISIONS.md §12 Phase D).
//
// Two concerns, kept apart:
//   - the append-only, tamper-evident AUDIT store (immutable trail, invariant 7);
//   - snapshot STATE repositories (current state that survives a restart).
//
// The domain stays pure: repositories sit behind it, and every state change
// still flows through `transition` — a repository only ever persists or reloads
// a snapshot that `transition` produced, never fabricates one.

export * from './sinks';
export * from './audit-store';
export * from './kv';
export * from './repository';
