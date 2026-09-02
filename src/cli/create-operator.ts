// Operator account provisioning — a one-off CLI, NOT an HTTP endpoint.
//
// There is deliberately no self-serve way to become an operator (mirrors 8.2's
// "no automated self-serve reset" posture for user accounts, for the same
// reason: an automated path to a privileged credential is an automated path an
// attacker could use). Provisioning an operator is an ops action, run by
// someone who already has deploy/environment access — the same trust boundary
// as setting a secret. This script wires the SAME configFromEnv()/buildServices()
// the real app uses, so it writes to the SAME state backend the deployment is
// actually running against (Postgres, SQLite, whatever LV_STATE_BACKEND says).
//
// Usage (after `npm run build`):
//   npm run create-operator -- --email=ops@example.com
//   npm run create-operator -- --email=ops@example.com --password="a chosen password"
//
// With no --password, a strong random one is generated and printed ONCE — copy
// it immediately, it is not stored or shown again. Re-running with the same
// --email resets the password (this is also how you recover a lost one).
//
// provisionOperator (below) is the testable core — pure over an injected
// AuthService + CredentialStore, no process.argv/process.exit/console — so this
// logic gets real automated coverage, not just a manual run. `main()` is the
// thin CLI shell around it.

import { randomBytes, randomUUID } from 'node:crypto';
import { configFromEnv } from '../config/bootstrap';
import { buildServices } from '../composition';
import { CredentialStore, type AuthService } from '../adapters/auth';
import type { KeyValueStore } from '../persistence';

export function randomPassword(): string {
  return randomBytes(18).toString('base64url'); // 24 chars, URL-safe, no ambiguous punctuation
}

export type ProvisionResult =
  | { readonly ok: true; readonly created: boolean } // created: false means an existing operator's password was reset
  | { readonly ok: false; readonly reason: string };

/**
 * Create a new operator credential, or reset an existing one's password.
 * `enroll()` refuses an already-enrolled identifier by design (the same guard
 * a real signup uses) — a reset is a deliberate, different action, so on that
 * specific failure this falls through to `CredentialStore.set()`, which
 * overwrites. Any other enroll failure is reported, not silently overwritten.
 */
export function provisionOperator(
  auth: AuthService,
  credentials: KeyValueStore,
  params: { readonly identifier: string; readonly password: string },
): ProvisionResult {
  const principalId = `op_${randomUUID()}`;
  const enrolled = auth.enroll({ identifier: params.identifier, kind: 'operator', principalId, password: params.password });
  if (enrolled.ok) return { ok: true, created: true };
  if (enrolled.reason !== 'identifier already enrolled') {
    return { ok: false, reason: enrolled.reason ?? 'unknown reason' };
  }
  new CredentialStore(credentials).set({ identifier: params.identifier, kind: 'operator', principalId, password: params.password });
  return { ok: true, created: false };
}

function parseArgs(argv: readonly string[]): { email?: string; password?: string } {
  const out: { email?: string; password?: string } = {};
  for (const arg of argv) {
    const m = /^--(email|password)=(.*)$/.exec(arg);
    if (m) out[m[1] as 'email' | 'password'] = m[2];
  }
  return out;
}

async function main(): Promise<void> {
  const { email, password } = parseArgs(process.argv.slice(2));
  if (email === undefined || email === '') {
    // eslint-disable-next-line no-console
    console.error('Usage: npm run create-operator -- --email=ops@example.com [--password=...]');
    process.exit(1);
  }

  const config = await configFromEnv();
  const services = buildServices(config);
  const finalPassword = password ?? randomPassword();

  const result = provisionOperator(services.auth, config.credentials, { identifier: email, password: finalPassword });
  if (!result.ok) {
    // eslint-disable-next-line no-console
    console.error(`Failed: ${result.reason}`);
    process.exit(1);
  }

  // eslint-disable-next-line no-console
  console.log(result.created ? `Operator account created for ${email}.` : `Password reset for existing operator ${email}.`);
  if (password === undefined) {
    // eslint-disable-next-line no-console
    console.log(`Generated password (copy this now — it will not be shown again):\n\n  ${finalPassword}\n`);
  }
  // eslint-disable-next-line no-console
  console.log('Log in at /console/login with this email and password.');
  process.exit(0);
}

// Only run as a script (`node create-operator.js`), never on import — this
// module is also imported for `provisionOperator`/`randomPassword` (by tests,
// and by anything else that wants the logic without the CLI shell).
if (require.main === module) {
  main().catch((error: unknown) => {
    // eslint-disable-next-line no-console
    console.error('create-operator failed:', error);
    process.exit(1);
  });
}
