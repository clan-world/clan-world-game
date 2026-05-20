import { createConvexClient } from '@clan-world/shared/adapters';
import { startHeartbeatScheduler } from './heartbeatScheduler';
import { makeConvexSnapshotSettleLatch } from './convexSnapshotSettleLatch';
import { configFromEnv, RunnerCastHeartbeat } from './runnerCastHeartbeat';

async function main(): Promise<void> {
  console.log(`[heartbeat-loop] starting at ${new Date().toISOString()}`);
  const abort = new AbortController();
  let shuttingDown = false;
  const onSignal = (sig: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[heartbeat-loop] ${sig} received — shutting down cleanly`);
    abort.abort();
  };
  process.on('SIGTERM', () => onSignal('SIGTERM'));
  process.on('SIGINT', () => onSignal('SIGINT'));

  const convex = createConvexClient();
  const settleLatch = makeConvexSnapshotSettleLatch({
    convex,
    signal: abort.signal,
    log: console,
  });

  startHeartbeatScheduler({
    heartbeatCaller: new RunnerCastHeartbeat(configFromEnv()),
    convex,
    signal: abort.signal,
    settleLatch,
    runnerId: process.env['RUNNER_ID'] ?? 'clanworld-heartbeat-loop',
  });

  await new Promise<void>(resolve => {
    if (abort.signal.aborted) {
      resolve();
      return;
    }
    abort.signal.addEventListener('abort', () => resolve(), { once: true });
  });
}

main().catch(err => {
  console.error('[heartbeat-loop] fatal:', err);
  process.exit(1);
});
