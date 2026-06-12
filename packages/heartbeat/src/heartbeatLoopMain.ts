import { createConvexClient } from '@clan-world/shared/adapters';
import { startHeartbeatScheduler } from './heartbeatScheduler';
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
  const heartbeatCaller = new RunnerCastHeartbeat(configFromEnv());

  // On anvil forks the chain clock can carry a persistent offset from wall
  // time (see readChainNowMs). nextHeartbeatAtTs is chain time, so schedule
  // against a chain-anchored clock when enabled; otherwise wall clock.
  let nowMs: (() => number) | undefined;
  if (process.env['HEARTBEAT_SCHEDULE_FROM_CHAIN'] === '1') {
    const offsetMs = (await heartbeatCaller.readChainNowMs()) - Date.now();
    console.log(`[heartbeat-loop] chain-clock scheduling enabled; offsetMs=${offsetMs}`);
    nowMs = () => Date.now() + offsetMs;
  }

  startHeartbeatScheduler({
    heartbeatCaller,
    convex,
    signal: abort.signal,
    runnerId: process.env['RUNNER_ID'] ?? 'clanworld-heartbeat-loop',
    nowMs,
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
