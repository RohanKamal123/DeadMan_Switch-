// Phase G — secret management (DECISIONS_PHASE_F_G.md G4).
//
// Every secret — the cancel-token HMAC secret, the session-signing secret, and
// the KMS master key — is INJECTED from the environment (a secrets manager in
// production), never committed and never logged. This module is the single place
// the process reads them; nothing here prints a secret.
//
// The cancel secret supports OVERLAPPING validity: `cancelTokenSecrets` is
// [current, ...previous]. Tokens are issued with the current secret and verified
// against all of them, so a rotation never invalidates a link a living user is
// about to click — invariant 1 must survive a key rotation.
//
// The KMS master key follows the SAME model (G2.1): `kmsKeyRing` is
// [current, ...previous] 32-byte keys. New content is wrapped under the current
// key; content already sealed under an older key stays unwrappable because the
// previous keys remain in the ring, so rotating the master key never strands
// stored content (rotation is re-wrap only, never re-encryption).

export interface Secrets {
  /** [current, ...previous]. Issue with the first; verify against all (rotation). */
  readonly cancelTokenSecrets: readonly string[];
  readonly sessionSecret: string;
  /** [current, ...previous] 32-byte AES-256 wrapping keys (G2). Wrap with the first; unwrap against all. */
  readonly kmsKeyRing: readonly Buffer[];
}

export class MissingSecretError extends Error {
  constructor(name: string) {
    super(`required secret ${name} is not set`);
    this.name = 'MissingSecretError';
  }
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (value === undefined || value === '') throw new MissingSecretError(name);
  return value;
}

function splitCsv(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** Parse a 64-hex-char (32-byte) AES-256 key, or throw naming the env var. */
function masterKeyFromHex(hex: string, name: string): Buffer {
  const key = Buffer.from(hex, 'hex');
  if (key.length !== 32) {
    throw new MissingSecretError(`${name} (must be 64 hex chars / 32 bytes)`);
  }
  return key;
}

/**
 * Load secrets from the environment. Names:
 *   LV_CANCEL_SECRET           — current cancel HMAC secret (required)
 *   LV_CANCEL_SECRET_PREVIOUS  — comma-separated previous secrets (optional)
 *   LV_SESSION_SECRET          — session signing secret (required)
 *   LV_KMS_MASTER_KEY          — current wrapping key, 64 hex chars = 32 bytes (required)
 *   LV_KMS_MASTER_KEY_PREVIOUS — comma-separated previous keys, each 64 hex chars (optional, rotation)
 */
export function secretsFromEnv(env: NodeJS.ProcessEnv = process.env): Secrets {
  const current = required(env, 'LV_CANCEL_SECRET');
  const previousCancel = splitCsv(env['LV_CANCEL_SECRET_PREVIOUS']);

  const currentKey = masterKeyFromHex(required(env, 'LV_KMS_MASTER_KEY'), 'LV_KMS_MASTER_KEY');
  const previousKeys = splitCsv(env['LV_KMS_MASTER_KEY_PREVIOUS']).map((hex) =>
    masterKeyFromHex(hex, 'LV_KMS_MASTER_KEY_PREVIOUS'),
  );

  return {
    cancelTokenSecrets: [current, ...previousCancel],
    sessionSecret: required(env, 'LV_SESSION_SECRET'),
    kmsKeyRing: [currentKey, ...previousKeys],
  };
}
