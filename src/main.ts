// The runnable entrypoint for a public release. It reads the environment, wires
// the concrete backends (bootstrap.ts), and starts the server(s) for this
// process's role (F1.5, LV_SERVER_ROLE):
//   - combined (default) — both the main web server (public site, legal,
//     memorials, user app, operator console, JSON API) AND the isolated cancel
//     server, in one process (dev / single-node).
//   - api                — the main web server only.
//   - cancel             — the isolated cancel server only, in its own failure
//     domain (DECISIONS.md 6.1; F1.4). Deploy this as a separate process/host to
//     give the highest-SLO surface true failure-domain isolation.
//
//   LV_PORT / LV_CANCEL_PORT   ports (default 8080 / 8081)
//   see src/config/bootstrap.ts for backend, vendor, KMS, policy, and secrets.

import { configFromEnv, serverRole } from './config/bootstrap';
import { createCancelOnlyServer } from './config/cancel-bootstrap';
import { createServers, createWorker, startWorker, startBlobHealthRefresh } from './composition';

function log(message: string): void {
  // eslint-disable-next-line no-console
  console.log(message);
}

/** Operational poll cadence for the worker (how often due work is checked). Default 60s. */
function workerIntervalMs(): number {
  const raw = process.env['LV_WORKER_INTERVAL_MS'];
  if (raw === undefined || raw === '') return 60_000;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`LV_WORKER_INTERVAL_MS must be a positive integer, got ${JSON.stringify(raw)}`);
  }
  return n;
}

/** The worker runs in the api/combined process unless explicitly disabled (LV_RUN_WORKER=0). */
function runWorkerHere(): boolean {
  return (process.env['LV_RUN_WORKER'] ?? '1') !== '0';
}

async function main(): Promise<void> {
  const role = serverRole();
  const port = Number(process.env['LV_PORT'] ?? 8080);
  const cancelPort = Number(process.env['LV_CANCEL_PORT'] ?? 8081);

  if (role === 'cancel') {
    // The cancel surface alone — no vendor, crypto, or billing dependency (F1.4).
    const cancelServer = await createCancelOnlyServer();
    cancelServer.listen(cancelPort, () => {
      log(`[legacy-vault] cancel server on :${cancelPort} (isolated failure domain, LV_SERVER_ROLE=cancel)`);
    });
    return;
  }

  const config = await configFromEnv();
  const { apiServer, cancelServer } = createServers(config);

  // Start the death-path clock (Phase-E worker). Without it, no account ever
  // advances, no reminder fires, and the weekly health check never runs. It can
  // never release early (the guards forbid it); a slow tick only ever delays.
  if (runWorkerHere()) {
    const intervalMs = workerIntervalMs();
    startWorker(createWorker(config), {
      intervalMs,
      onError: (error) => {
        // A tick failure delays; it never releases. Log and keep going.
        // eslint-disable-next-line no-console
        console.error('[legacy-vault] worker tick failed (will retry next interval):', error);
      },
    });
    log(`[legacy-vault] worker started (tick every ${intervalMs}ms)`);

    // A network-backed storage adapter (e.g. R2) can't answer its health probe
    // synchronously — refresh its cache on the same cadence so it doesn't sit
    // reporting unhealthy forever on a quiet deployment (see r2-storage.ts).
    // No-op for the in-memory dev adapter.
    if (startBlobHealthRefresh(config, intervalMs) !== undefined) {
      log('[legacy-vault] storage health probe refresh started (network-backed adapter detected)');
    }
  } else {
    log('[legacy-vault] worker NOT started here (LV_RUN_WORKER=0) — run it in exactly one process.');
  }

  apiServer.listen(port, () => {
    log(`[legacy-vault] web server on :${port}`);
  });

  if (role === 'combined') {
    cancelServer.listen(cancelPort, () => {
      log(`[legacy-vault] cancel server on :${cancelPort} (isolated failure domain)`);
    });
  } else {
    log('[legacy-vault] cancel server NOT started here (LV_SERVER_ROLE=api) — run a separate LV_SERVER_ROLE=cancel process.');
  }
}

main().catch((error: unknown) => {
  // eslint-disable-next-line no-console
  console.error('[legacy-vault] failed to start:', error);
  process.exit(1);
});
