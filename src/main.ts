// The runnable entrypoint for a public release. It reads the environment, wires
// the concrete backends (bootstrap.ts), and starts the two servers: the main web
// server (public site, legal, memorials, user app, operator console, and the
// JSON API underneath) and the dedicated cancel server in its own failure domain
// — the highest-SLO surface in the product (DECISIONS.md 6.1).
//
//   LV_PORT / LV_CANCEL_PORT   ports (default 8080 / 8081)
//   see src/config/bootstrap.ts for backend, billing, and secret variables.

import { configFromEnv } from './config/bootstrap';
import { createServers } from './composition';

async function main(): Promise<void> {
  const config = await configFromEnv();
  const { apiServer, cancelServer } = createServers(config);

  const port = Number(process.env['LV_PORT'] ?? 8080);
  const cancelPort = Number(process.env['LV_CANCEL_PORT'] ?? 8081);

  apiServer.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`[legacy-vault] web server on :${port}`);
  });
  cancelServer.listen(cancelPort, () => {
    // eslint-disable-next-line no-console
    console.log(`[legacy-vault] cancel server on :${cancelPort} (isolated failure domain)`);
  });
}

main().catch((error: unknown) => {
  // eslint-disable-next-line no-console
  console.error('[legacy-vault] failed to start:', error);
  process.exit(1);
});
