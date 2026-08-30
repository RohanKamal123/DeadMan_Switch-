// Phase G — adapters (DECISIONS_PHASE_F_G.md G1/G2).
//
// Vendor integrations behind ports. `models/` stays empty by design (no AI in
// V1; see its README). Channel adapters (email/SMS/push/storage) and the crypto
// adapter live here; no vendor SDK is imported outside these directories.

export * from './channels';
export * from './crypto';
