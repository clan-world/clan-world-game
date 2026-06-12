import { createConvexClient } from '@clan-world/shared/adapters';
import { startHeartbeatScheduler } from './heartbeatScheduler';
import { configFromEnv, RunnerCastHeartbeat } from './runnerCastHeartbeat';

/**
 * On anvil forks the chain clock can carry a persistent offset from wall time
 * (see RunnerCastHeartbeat.readChainNowMs). nextHeartbeatAtTs is chain time,
 * so when HEARTBEAT_SCHEDULE_FROM_CHAIN=1 the scheduler clock is anchored to
 * chain time via a boot-time offset; otherwise (and on any anchor failure)
 * wall-clock scheduling is unchanged. The offset is boot-static: anvil's
 * offset persists for the node's lifetime, so a single anchor suffices and a
 * process restart re-anchors. Returns undefined for wall-clock scheduling.
 */
export async function resolveSchedulerNowMs(
  caller: { readChainNowMs(): Promise<number> },
  env: Record<string, string | undefined> = process.env,
): Promise<(() => number) | undefined> {
  if (env['HEARTBEAT_SCHEDULE_FROM_CHAIN'] !== '1') return undefined;
  try {
    const offsetMs = (await caller.readChainNowMs()) - Date.now();
    console.log(`[heartbeat-loop] chain-clock scheduling enabled; offsetMs=${offsetMs}`);
    return () => Date.now() + offsetMs;
  } catch (err) {
    // Degrade, don't die: a transient RPC blip at boot must not crash-loop
    // the daemon. Wall-clock scheduling over-sleeps on offset forks but
    // still ticks; the loud log makes the degradation observable.
    console.error(
      '[heartbeat-loop] chain-clock anchor failed; falling back to wall-clock scheduling:',
      err,
    );
    return undefined;
  }
}

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
  const nowMs = await resolveSchedulerNowMs(heartbeatCaller);

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
