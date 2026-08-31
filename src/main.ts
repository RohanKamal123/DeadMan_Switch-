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
import { createServers } from './composition';

function log(message: string): void {
  // eslint-disable-next-line no-console
  console.log(message);
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
