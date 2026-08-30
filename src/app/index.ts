// Phase F — the application-service tier (DECISIONS_PHASE_F_G.md F0).
//
// The only tier that mutates. Each service loads context via a Phase D
// repository, calls the pure core (`machine.apply` → `transition`, or a console
// action), and persists the result. It is transport-agnostic — no HTTP types
// leak in — so every mutation is testable without a socket, and the HTTP tier
// (`src/http/`) can stay thin. No service writes state directly; the machine's
// guards remain the single source of truth for every invariant.

export * from './principal';
export * from './cancel-service';
export * from './liveness-service';
export * from './operator-service';
