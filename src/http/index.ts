// Phase F — the HTTP transport tier (DECISIONS_PHASE_F_G.md F0–F3).
//
// Thin transport only: routing, parsing, auth, serialization. It calls the
// application-service tier (`src/app/`) and never touches a repository or the
// machine directly, so no surface writes state. The cancel surface ships first
// and isolated because it is the product's highest-SLO path (DECISIONS.md 6.1).

export * from './design';
export * from './message';
export * from './metrics';
export * from './pages';
export * from './recipient-pages';
export * from './marketing-pages';
export * from './legal-pages';
export * from './memorial-pages';
export * from './app-pages';
export * from './operator-pages';
export * from './app-session';
export * from './site-handler';
export * from './auth';
export * from './cancel-handler';
export * from './checkin-handler';
export * from './operator-handler';
export * from './recipient-handler';
export * from './user-handler';
export * from './admin-handler';
export * from './login-handler';
export * from './server';
