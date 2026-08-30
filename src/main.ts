// Legacy Vault — the process entrypoint.
//
// A thin shell over `startApp` (bootstrap.ts): boot the system, then wire
// graceful shutdown so an operator restart stops the scheduler and frees the
// ports cleanly. All the wiring, config validation, and fail-safe defaults live
// in bootstrap.ts so they can be unit-tested without opening a socket.
//
// Run with:  LV_CONFIG_FILE=./config.json LV_CANCEL_SECRET=… … node dist/main.js
// (secrets and vendor credentials come from the environment; the JSON config
// file carries only non-secret operational values — see bootstrap.ts.)

import { startApp, type RunningApp } from './bootstrap';

async function main(): Promise<void> {
  let app: RunningApp;
  try {
    app = await startApp(process.env);
  } catch (error) {
    // A config or secret gap must fail loudly at boot, never serve half-configured.
    // eslint-disable-next-line no-console
    console.error(`[legacy-vault] failed to start: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
    return;
  }

  let shuttingDown = false;
  const onSignal = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    // eslint-disable-next-line no-console
    console.log(`[legacy-vault] received ${signal}`);
    void app.shutdown().then(() => process.exit(0));
  };
  process.on('SIGINT', () => onSignal('SIGINT'));
  process.on('SIGTERM', () => onSignal('SIGTERM'));
}

void main();
