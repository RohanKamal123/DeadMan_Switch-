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

export interface Secrets {
  /** [current, ...previous]. Issue with the first; verify against all (rotation). */
  readonly cancelTokenSecrets: readonly string[];
  readonly sessionSecret: string;
  /** 32 bytes for AES-256 envelope wrapping (G2). */
  readonly kmsMasterKey: Buffer;
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

/**
 * Load secrets from the environment. Names:
 *   LV_CANCEL_SECRET           — current cancel HMAC secret (required)
 *   LV_CANCEL_SECRET_PREVIOUS  — comma-separated previous secrets (optional)
 *   LV_SESSION_SECRET          — session signing secret (required)
 *   LV_KMS_MASTER_KEY          — 64 hex chars = 32 bytes (required)
 */
/**
 * The cancel-token secret(s) alone — [current, ...previous] for overlapping
 * validity. This is deliberately separated from `secretsFromEnv` so the isolated
 * cancel process (F1.5) can boot on ONLY the signing secret and the state store,
 * with no dependency on the KMS key, session secret, or any vendor credential
 * that could make invariant 1's surface fail closed (F1.2).
 */
export function cancelSecretsFromEnv(env: NodeJS.ProcessEnv = process.env): readonly string[] {
  const current = required(env, 'LV_CANCEL_SECRET');
  const previous = (env['LV_CANCEL_SECRET_PREVIOUS'] ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return [current, ...previous];
}

export function secretsFromEnv(env: NodeJS.ProcessEnv = process.env): Secrets {
  const masterKeyHex = required(env, 'LV_KMS_MASTER_KEY');
  const kmsMasterKey = Buffer.from(masterKeyHex, 'hex');
  if (kmsMasterKey.length !== 32) {
    throw new MissingSecretError('LV_KMS_MASTER_KEY (must be 64 hex chars / 32 bytes)');
  }
  return {
    cancelTokenSecrets: cancelSecretsFromEnv(env),
    sessionSecret: required(env, 'LV_SESSION_SECRET'),
    kmsMasterKey,
  };
}
