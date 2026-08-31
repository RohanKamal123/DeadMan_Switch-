// Isolated cancel-surface bootstrap (F1.4 / F1.5).
//
// The self-serve cancel link is the product's highest-SLO surface and the
// embodiment of invariant 1 (CANCELLED reachable from every state). When
// LV_SERVER_ROLE=cancel, the cancel routes run as their OWN process/host in their
// OWN failure domain — so this entrypoint deliberately imports NOTHING that could
// make the surface fail closed: no channel vendor, no crypto/KMS, no billing, no
// session auth. It needs only the state store, the per-account audit sink, and
// the cancel-token signing secret (F1.2). Even if everything else in the platform
// is down or misconfigured, a living user's cancel link still works.

import * as http from 'node:http';
import { MachineRepository } from '../persistence';
import { CancelService } from '../app/cancel-service';
import { createCancelServer } from '../http/server';
import type { CancelFallback } from '../http/pages';
import { cancelSecretsFromEnv } from '../adapters/secrets';
import type { RequestMetrics } from '../http/metrics';
import { stateBackend, auditFactory } from './state';

function env(name: string, fallback = ''): string {
  return process.env[name] ?? fallback;
}

/** The cancel fail-safe links, read from the same variables the combined config uses. */
export function cancelFallbackFromEnv(): CancelFallback {
  return {
    supportUrl: env('LV_SUPPORT_URL', 'mailto:support@legacyvault.example'),
    inAppCancelUrl: `${env('LV_BASE_URL', 'http://localhost:8080')}/app`,
  };
}

/**
 * Build ONLY the isolated cancel server from the environment. Depends on the
 * state store, the audit sink, and the cancel secret — nothing else. Returns an
 * unstarted server; call `.listen(...)`.
 */
export async function createCancelOnlyServer(metrics?: RequestMetrics): Promise<http.Server> {
  const state = await stateBackend();
  const auditFor = auditFactory();
  const machines = new MachineRepository(state);
  const service = new CancelService({ machines, auditFor, secret: cancelSecretsFromEnv() });
  const deps = { service, fallback: cancelFallbackFromEnv(), now: () => Date.now() };
  return createCancelServer(deps, metrics === undefined ? {} : { metrics });
}
