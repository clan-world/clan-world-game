import { HeartbeatRateLimitedError, type IHeartbeatCaller } from '@clan-world/agents/seams';
import type { IConvexClient, RunnerStatusUpdate } from '@clan-world/shared/adapters';
import type { SettleLatch } from './settleLatch';
import { sendTelegramAlert } from './telegramAlert';

export type HeartbeatFireResult = RunnerStatusUpdate['lastFireResult'];

export interface HeartbeatSchedulerDeps {
  heartbeatCaller: IHeartbeatCaller;
  /** AbortSignal for clean shutdown. */
  signal: AbortSignal;
  /** Logger — defaults to console. Tests pass a recorder. */
  log?: {
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
  };
  /**
   * Shared latch — Cycle A only fires heartbeat after Cycle B settles a new tick.
   * This can intentionally delay a heartbeat past nextHeartbeatAtTs + jitter
   * while Elders are still in their settle window; liveness beats interrupting
   * the order-submission phase.
   */
  settleLatch?: SettleLatch;
  /** Convex status sink. Missing/failed writes are logged but non-fatal. */
  convex?: Pick<IConvexClient, 'postRunnerStatus'>;
  /** Stable id for the runnerStatus row. */
  runnerId?: string;
  /** Override alert sender for tests. */
  alert?: (message: string) => Promise<{ ok: boolean; error?: string }>;
  /** Override current time for tests. */
  nowMs?: () => number;
}

export const HEARTBEAT_JITTER_MS = 500;
export const HEARTBEAT_RETRY_BACKOFF_MS = [1_000, 2_000, 5_000, 10_000] as const;
const SETTLE_LATCH_RECHECK_MS = 1_000;
const HOT_LOOP_GUARD_MS = 1_000;
const ALERT_DEDUP_WINDOW_MS = 5 * 60 * 1_000;

/**
 * Cycle A — heartbeat driver (independent of Elder activity).
 *
 * Schedules from on-chain getWorldState().nextHeartbeatAtTs instead of a local
 * fixed interval. The owner-configured heartbeatIntervalSeconds is read once
 * at boot for observability; cadence changes are applied operationally by
 * updating the chain value and restarting this process.
 */
export function startHeartbeatScheduler(deps: HeartbeatSchedulerDeps): void {
  const log = deps.log ?? {
    info: (...a: unknown[]) => console.log('[heartbeat]', ...a),
    warn: (...a: unknown[]) => console.warn('[heartbeat]', ...a),
    error: (...a: unknown[]) => console.error('[heartbeat]', ...a),
  };

  if (deps.signal.aborted) return;

  void runHeartbeatScheduler({ ...deps, log }).catch(err => {
    if (deps.signal.aborted) return;
    log.error('heartbeat scheduler exited:', err);
  });
}

export function computeHeartbeatDelayMs(
  nextHeartbeatAtTs: number,
  nowMs: number,
  jitterMs = HEARTBEAT_JITTER_MS,
): number {
  return Math.max(0, nextHeartbeatAtTs * 1000 - nowMs) + jitterMs;
}

export function classifyHeartbeatError(err: unknown): HeartbeatFireResult {
  if (err instanceof HeartbeatRateLimitedError) return 'rate-limited';
  if (err instanceof Error) {
    if (err.name === 'HeartbeatTimeoutError' || err.name.includes('Timeout')) return 'timeout';
    if (err.name.includes('Revert') || /revert|rate[- ]limited/i.test(err.message)) return 'revert';
  }
  return 'error';
}

async function runHeartbeatScheduler(
  deps: HeartbeatSchedulerDeps & {
    log: NonNullable<HeartbeatSchedulerDeps['log']>;
  },
): Promise<void> {
  const runnerId = deps.runnerId ?? 'clanworld-runner';
  const nowMs = deps.nowMs ?? (() => Date.now());
  const alert = deps.alert ?? sendTelegramAlert;
  let heartbeatIntervalSeconds: number | undefined;
  let lastHeartbeatForTick = -1;
  let consecutiveReadFailures = 0;
  let lastAlertAtMs: number | undefined;

  try {
    heartbeatIntervalSeconds = await deps.heartbeatCaller.readHeartbeatIntervalSeconds();
    deps.log.info(`on-chain heartbeat interval: ${heartbeatIntervalSeconds}s`);
  } catch (err) {
    deps.log.error('failed to read heartbeatIntervalSeconds at boot:', err);
    await postRunnerStatus(deps, {
      runnerId,
      lastFireResult: 'boot-error',
      lastFailureMessage: `boot interval read failed: ${messageFrom(err)}`,
    });
  }

  while (!deps.signal.aborted) {
    let nextHeartbeatAtTs: number;
    try {
      nextHeartbeatAtTs = await deps.heartbeatCaller.readNextHeartbeatAtTs();
      consecutiveReadFailures = 0;
    } catch (err) {
      deps.log.error('failed to read nextHeartbeatAtTs:', err);
      await postRunnerStatus(deps, {
        runnerId,
        lastFireResult: 'error',
        lastFailureMessage: `nextHeartbeatAtTs read failed: ${messageFrom(err)}`,
        heartbeatIntervalSeconds,
      });
      const backoffMs = HEARTBEAT_RETRY_BACKOFF_MS[
        Math.min(consecutiveReadFailures, HEARTBEAT_RETRY_BACKOFF_MS.length - 1)
      ] ?? HEARTBEAT_RETRY_BACKOFF_MS[0];
      consecutiveReadFailures++;
      await sleepWithSignal(backoffMs, deps.signal);
      continue;
    }

    await sleepWithSignal(
      computeHeartbeatDelayMs(nextHeartbeatAtTs, nowMs()),
      deps.signal,
    );
    if (deps.signal.aborted) break;

    const settledSnapshot = deps.settleLatch ? deps.settleLatch.lastSettledTick() : -1;
    if (deps.settleLatch && settledSnapshot <= lastHeartbeatForTick) {
      deps.log.info(
        `waiting for Cycle B to settle (last settled: ${settledSnapshot}, last heartbeat for: ${lastHeartbeatForTick})`,
      );
      await sleepWithSignal(SETTLE_LATCH_RECHECK_MS, deps.signal);
      continue;
    }

    const result = await attemptHeartbeatWithBackoff({
      ...deps,
      runnerId,
      heartbeatIntervalSeconds,
      nextHeartbeatAtTs,
      settledSnapshot,
    });
    if (result.success) {
      if (deps.settleLatch) lastHeartbeatForTick = settledSnapshot;
      if (!result.rateLimited) lastAlertAtMs = undefined;
      const nextAfterSuccess = await deps.heartbeatCaller
        .readNextHeartbeatAtTs()
        .catch(() => undefined);
      if (nextAfterSuccess !== undefined && nextAfterSuccess * 1000 <= nowMs()) {
        deps.log.warn(
          `heartbeat succeeded but nextHeartbeatAtTs (${nextAfterSuccess}) is still in the past; sleeping ${HOT_LOOP_GUARD_MS}ms before retry`,
        );
        await sleepWithSignal(HOT_LOOP_GUARD_MS, deps.signal);
      }
      continue;
    }

    if (result.aborted || result.lastFireResult === 'rate-limited') continue;
    const currentMs = nowMs();
    if (lastAlertAtMs !== undefined && currentMs - lastAlertAtMs < ALERT_DEDUP_WINDOW_MS) {
      deps.log.warn(`suppressing duplicate heartbeat alert: ${result.message}`);
      continue;
    }
    lastAlertAtMs = currentMs;
    const alertMessage =
      `ClanWorld heartbeat failed after retries: ${result.message}`;
    const alertResult = await alert(alertMessage);
    if (!alertResult.ok) {
      const msg = `Telegram alert failed: ${alertResult.error ?? 'unknown error'}`;
      deps.log.error(msg);
      await postRunnerStatus(deps, {
        runnerId,
        lastFireResult: 'error',
        lastFailureMessage: msg,
        heartbeatIntervalSeconds,
        nextHeartbeatAtTs,
      });
    }
  }
}

async function attemptHeartbeatWithBackoff(
  deps: HeartbeatSchedulerDeps & {
    log: NonNullable<HeartbeatSchedulerDeps['log']>;
    runnerId: string;
    heartbeatIntervalSeconds?: number;
    nextHeartbeatAtTs?: number;
    settledSnapshot: number;
  },
): Promise<
  | { success: true; rateLimited?: false }
  | { success: true; rateLimited: true }
  | { success: false; aborted: true; message: string; lastFireResult?: HeartbeatFireResult }
  | { success: false; aborted: false; message: string; lastFireResult: HeartbeatFireResult }
> {
  for (let attempt = 0; attempt <= HEARTBEAT_RETRY_BACKOFF_MS.length; attempt++) {
    try {
      const { txHash } = await deps.heartbeatCaller.callHeartbeat();
      deps.log.info(`heartbeat tx confirmed: ${txHash}`);
      await postRunnerStatus(deps, {
        runnerId: deps.runnerId,
        lastFireAt: Date.now(),
        lastFireResult: 'success',
        lastFailureMessage: undefined,
        heartbeatIntervalSeconds: deps.heartbeatIntervalSeconds,
        nextHeartbeatAtTs: deps.nextHeartbeatAtTs,
      });
      return { success: true };
    } catch (err) {
      if (err instanceof HeartbeatRateLimitedError) {
        const lastFailureMessage = messageFrom(err);
        deps.log.warn(`heartbeat rate-limited: ${lastFailureMessage}`);
        await postRunnerStatus(deps, {
          runnerId: deps.runnerId,
          lastFireResult: 'rate-limited',
          lastFailureMessage,
          heartbeatIntervalSeconds: deps.heartbeatIntervalSeconds,
          nextHeartbeatAtTs: deps.nextHeartbeatAtTs,
        });
        return { success: true, rateLimited: true };
      }
      if (deps.signal.aborted) return { success: false, aborted: true, message: 'aborted' };
      if (isHeartbeatTimeoutError(err) && deps.nextHeartbeatAtTs !== undefined) {
        const nextAfterTimeout = await deps.heartbeatCaller
          .readNextHeartbeatAtTs()
          .catch(() => undefined);
        if (nextAfterTimeout !== undefined && nextAfterTimeout > deps.nextHeartbeatAtTs) {
          deps.log.info(
            `heartbeat receipt timed out, but nextHeartbeatAtTs advanced from ${deps.nextHeartbeatAtTs} to ${nextAfterTimeout}`,
          );
          await postRunnerStatus(deps, {
            runnerId: deps.runnerId,
            lastFireAt: Date.now(),
            lastFireResult: 'success',
            lastFailureMessage: undefined,
            heartbeatIntervalSeconds: deps.heartbeatIntervalSeconds,
            nextHeartbeatAtTs: nextAfterTimeout,
          });
          return { success: true };
        }
      }
      const lastFireResult = classifyHeartbeatError(err);
      const lastFailureMessage = messageFrom(err);
      deps.log.warn(`heartbeat attempt ${attempt + 1} failed (${lastFireResult}): ${lastFailureMessage}`);
      await postRunnerStatus(deps, {
        runnerId: deps.runnerId,
        lastFireResult,
        lastFailureMessage,
        heartbeatIntervalSeconds: deps.heartbeatIntervalSeconds,
        nextHeartbeatAtTs: deps.nextHeartbeatAtTs,
      });

      if (attempt === HEARTBEAT_RETRY_BACKOFF_MS.length) {
        return { success: false, aborted: false, message: lastFailureMessage, lastFireResult };
      }
      const backoffMs = HEARTBEAT_RETRY_BACKOFF_MS[attempt] ?? HEARTBEAT_RETRY_BACKOFF_MS[0];
      await sleepWithSignal(backoffMs, deps.signal);
      if (deps.signal.aborted) return { success: false, aborted: true, message: 'aborted' };
    }
  }
  return { success: false, aborted: false, message: 'retry loop exhausted', lastFireResult: 'error' };
}

async function postRunnerStatus(
  deps: Pick<HeartbeatSchedulerDeps, 'convex' | 'log'>,
  status: RunnerStatusUpdate,
): Promise<void> {
  if (!deps.convex) return;
  try {
    await deps.convex.postRunnerStatus(status);
  } catch (err) {
    deps.log?.warn('runnerStatus update failed:', err);
  }
}

function messageFrom(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function isHeartbeatTimeoutError(err: unknown): boolean {
  return err instanceof Error && (err.name === 'HeartbeatTimeoutError' || err.name.includes('Timeout'));
}

async function sleepWithSignal(ms: number, signal: AbortSignal): Promise<void> {
  if (ms <= 0) return;
  await new Promise<void>(resolve => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      resolve();
    };
    signal.addEventListener('abort', onAbort);
  });
}
