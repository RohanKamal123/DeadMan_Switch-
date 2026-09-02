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
//
// GRACEFUL SHUTDOWN: a platform redeploy or restart sends SIGTERM. The Postgres
// state backend and blob-store writes (R2) queue real network writes behind a
// synchronous KeyValueStore contract (PostgresKeyValueStore's header explains
// why) — killed without flushing, the last few writes before shutdown could be
// lost. On SIGTERM/SIGINT this stops the worker/health-refresh intervals first
// (no new work starts), flushes pending writes, then closes the servers.

import type * as http from 'node:http';
import { configFromEnv, serverRole } from './config/bootstrap';
import { createCancelOnlyServer } from './config/cancel-bootstrap';
import { createServers, createWorker, startWorker, startVendorHealthRefresh, flushIfPossible, flushPendingWrites, type AppConfig, type Services, type WorkerHandle } from './composition';
import { LoggingRequestMetrics } from './http';

/**
 * The cancel endpoint's uptime/latency signals (F7, DECISIONS.md 6.1) — one
 * structured line per request, an ALERT-prefixed line to stderr on an error
 * status or a slow request. Every log platform captures stdout/stderr, so this
 * needs no extra vendor wiring to be a real "ships to the ops alerting path"
 * signal. `LV_CANCEL_SLOW_MS` (default 1000) is a log-severity threshold only —
 * never a domain timer, never gates a transition.
 */
function cancelMetrics(): LoggingRequestMetrics {
  const raw = process.env['LV_CANCEL_SLOW_MS'];
  const slowMs = raw === undefined || raw === '' ? undefined : Number(raw);
  return new LoggingRequestMetrics({ label: 'cancel', ...(slowMs !== undefined ? { slowMs } : {}) });
}

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

function closeServer(server: http.Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

/** Stop background intervals, close listening sockets, flush pending writes, then exit. Runs once. */
function installShutdown(
  stoppers: readonly (WorkerHandle | undefined)[],
  servers: readonly http.Server[],
  flush: () => Promise<void>,
): void {
  let shuttingDown = false;
  const handler = (signal: NodeJS.Signals): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    log(`[legacy-vault] ${signal} received — shutting down gracefully`);
    void (async () => {
      for (const s of stoppers) s?.stop();
      await Promise.all(servers.map(closeServer));
      try {
        await flush();
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error('[legacy-vault] a pending write failed to flush during shutdown:', error);
      }
      log('[legacy-vault] shutdown complete');
      process.exit(0);
    })();
  };
  process.on('SIGTERM', handler);
  process.on('SIGINT', handler);
}

async function main(): Promise<void> {
  const role = serverRole();
  const port = Number(process.env['LV_PORT'] ?? 8080);
  const cancelPort = Number(process.env['LV_CANCEL_PORT'] ?? 8081);

  if (role === 'cancel') {
    // The cancel surface alone — no vendor, crypto, or billing dependency (F1.4).
    const { server: cancelServer, state } = await createCancelOnlyServer(cancelMetrics());
    cancelServer.listen(cancelPort, () => {
      log(`[legacy-vault] cancel server on :${cancelPort} (isolated failure domain, LV_SERVER_ROLE=cancel)`);
    });
    installShutdown([], [cancelServer], () => flushIfPossible(state));
    return;
  }

  const config: AppConfig = await configFromEnv();
  const { apiServer, cancelServer, services }: { apiServer: http.Server; cancelServer: http.Server; services: Services } = createServers(config, cancelMetrics());

  const stoppers: (WorkerHandle | undefined)[] = [];

  // Start the death-path clock (Phase-E worker). Without it, no account ever
  // advances, no reminder fires, and the weekly health check never runs. It can
  // never release early (the guards forbid it); a slow tick only ever delays.
  if (runWorkerHere()) {
    const intervalMs = workerIntervalMs();
    stoppers.push(
      startWorker(createWorker(config), {
        intervalMs,
        onError: (error) => {
          // A tick failure delays; it never releases. Log and keep going.
          // eslint-disable-next-line no-console
          console.error('[legacy-vault] worker tick failed (will retry next interval):', error);
        },
      }),
    );
    log(`[legacy-vault] worker started (tick every ${intervalMs}ms)`);

    // A network-backed vendor adapter (R2, Resend, Twilio) can't answer its
    // health probe synchronously — refresh its cache on the same cadence so it
    // doesn't sit reporting unhealthy forever on a quiet deployment (see each
    // adapter's file header). No-op per-channel for the in-memory dev adapters.
    const vendorHealth = startVendorHealthRefresh(config, intervalMs);
    if (vendorHealth !== undefined) {
      stoppers.push(vendorHealth);
      log('[legacy-vault] vendor health probe refresh started (network-backed adapter(s) detected)');
    }
  } else {
    log('[legacy-vault] worker NOT started here (LV_RUN_WORKER=0) — run it in exactly one process.');
  }

  apiServer.listen(port, () => {
    log(`[legacy-vault] web server on :${port}`);
  });

  const servers: http.Server[] = [apiServer];
  if (role === 'combined') {
    cancelServer.listen(cancelPort, () => {
      log(`[legacy-vault] cancel server on :${cancelPort} (isolated failure domain)`);
    });
    servers.push(cancelServer);
  } else {
    log('[legacy-vault] cancel server NOT started here (LV_SERVER_ROLE=api) — run a separate LV_SERVER_ROLE=cancel process.');
  }

  installShutdown(stoppers, servers, () => flushPendingWrites(config, services));
}

main().catch((error: unknown) => {
  // eslint-disable-next-line no-console
  console.error('[legacy-vault] failed to start:', error);
  process.exit(1);
});
