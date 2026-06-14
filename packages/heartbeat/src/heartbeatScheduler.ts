import { HeartbeatRateLimitedError, type IHeartbeatCaller } from '@clan-world/agents/seams';
import type { IConvexClient, RunnerStatusUpdate } from '@clan-world/shared/adapters';
import { writeHeartbeatSuccessFile } from './heartbeatSuccessFile';
import { sendTelegramAlert } from './telegramAlert';

export type HeartbeatFireResult = RunnerStatusUpdate['lastFireResult'];

export type ForkTimeAdvancer = {
  readChainNowMs?: () => Promise<number>;
  advanceForkTimeTo?: (targetUnixTs: number) => Promise<boolean>;
  isForkTimeAdvanceEnabled?: () => boolean;
};

export interface HeartbeatSchedulerDeps {
  heartbeatCaller: IHeartbeatCaller & ForkTimeAdvancer;
  /** AbortSignal for clean shutdown. */
  signal: AbortSignal;
  /** Logger — defaults to console. Tests pass a recorder. */
  log?: {
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
  };
  /** Convex status sink. Missing/failed writes are logged but non-fatal. */
  convex?: Pick<IConvexClient, 'postRunnerStatus'>;
  /** Stable id for the runnerStatus row. */
  runnerId?: string;
  /** Override alert sender for tests. */
  alert?: (message: string) => Promise<{ ok: boolean; error?: string }>;
  /** Override current time for tests. */
  nowMs?: () => number;
}

export const HEARTBEAT_SAFETY_MARGIN_MS = 1_500;
export const HEARTBEAT_JITTER_MS = HEARTBEAT_SAFETY_MARGIN_MS;
export const HEARTBEAT_RATE_LIMIT_RETRY_FLOOR_MS = 2_000;
export const HEARTBEAT_RATE_LIMIT_RETRY_MAX = 5;
export const HEARTBEAT_RETRY_BACKOFF_MS = [1_000, 2_000, 5_000, 10_000] as const;
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
  safetyMarginMs = HEARTBEAT_SAFETY_MARGIN_MS,
): number {
  return Math.max(0, nextHeartbeatAtTs * 1000 + safetyMarginMs - nowMs);
}

export function computeWallIntervalDelayMs(
  intervalMs: number,
  lastBeatWallMs: number,
  wallNowMs: number,
): number {
  return Math.max(0, intervalMs - (wallNowMs - lastBeatWallMs));
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
  let consecutiveReadFailures = 0;
  let lastBeatWallMs: number | undefined;
  const lastAlertAtMs = new Map<string, number>();

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

    // Instrumentation: surface the scheduling time-basis so we can confirm
    // whether the on-chain nextHeartbeatAtTs (chain time) and the local wall
    // clock diverge (e.g. on an anvil-fork whose block.timestamp drifts ahead),
    // which would skew computedDelayMs. Cheap (no extra RPC); read from logs.
    const forkTimeAdvanceEnabled = isForkTimeAdvanceEnabled(deps);
    const schedulerNowMs = await readSchedulerNowMs(deps, nowMs);
    const delayMs = forkTimeAdvanceEnabled
      ? computeForkWallDelayMs({
        heartbeatIntervalSeconds,
        lastBeatWallMs,
        wallNowMs: schedulerNowMs,
      })
      : computeHeartbeatDelayMs(nextHeartbeatAtTs, schedulerNowMs);
    deps.log.info(
      `heartbeat schedule: nextHeartbeatAtTs=${nextHeartbeatAtTs}s schedulerNowMs=${schedulerNowMs} computedDelayMs=${delayMs}`,
    );
    await sleepWithSignal(delayMs, deps.signal);
    if (deps.signal.aborted) break;

    await prepareHeartbeatWindow({
      deps,
      nextHeartbeatAtTs,
      fallbackNowMs: nowMs,
    });
    if (deps.signal.aborted) break;

    const result = await attemptHeartbeatWithBackoff({
      ...deps,
      runnerId,
      heartbeatIntervalSeconds,
      nextHeartbeatAtTs,
      lastBeatWallMs,
    });
    if (result.success) {
      lastAlertAtMs.clear();
      lastBeatWallMs = nowMs();
    }
    if (result.success) {
      const nextAfterSuccess = await deps.heartbeatCaller
        .readNextHeartbeatAtTs()
        .catch(() => undefined);
      const schedulerNowAfterSuccessMs = await readSchedulerNowMs(deps, nowMs);
      if (nextAfterSuccess !== undefined && nextAfterSuccess * 1000 <= schedulerNowAfterSuccessMs) {
        deps.log.warn(
          `heartbeat succeeded but nextHeartbeatAtTs (${nextAfterSuccess}) is still in the past; sleeping ${HOT_LOOP_GUARD_MS}ms before retry`,
        );
        await sleepWithSignal(HOT_LOOP_GUARD_MS, deps.signal);
      }
      continue;
    }

    if (result.aborted) continue;
    const currentMs = nowMs();
    const alertClass = result.lastFireResult;
    const lastAlertForClassAtMs = lastAlertAtMs.get(alertClass);
    if (
      lastAlertForClassAtMs !== undefined &&
      currentMs - lastAlertForClassAtMs < ALERT_DEDUP_WINDOW_MS
    ) {
      deps.log.warn(`suppressing duplicate heartbeat alert: ${result.message}`);
      continue;
    }
    const alertMessage =
      `ClanWorld heartbeat failed after retries: ${result.message}`;
    const alertResult = await alert(alertMessage);
    if (alertResult.ok) {
      lastAlertAtMs.set(alertClass, currentMs);
    } else if (alertResult.error === 'TELEGRAM_BOT_TOKEN is not set') {
      deps.log.info('[heartbeatScheduler] Telegram alert skipped: TELEGRAM_BOT_TOKEN is not set');
    } else {
      deps.log.error('[heartbeatScheduler] Telegram alert failed:', alertResult.error);
    }
  }
}

async function attemptHeartbeatWithBackoff(
  deps: HeartbeatSchedulerDeps & {
    log: NonNullable<HeartbeatSchedulerDeps['log']>;
    runnerId: string;
    heartbeatIntervalSeconds?: number;
    nextHeartbeatAtTs?: number;
    lastBeatWallMs?: number;
  },
): Promise<
  | { success: true }
  | { success: false; aborted: true; message: string; lastFireResult?: HeartbeatFireResult }
  | { success: false; aborted: false; message: string; lastFireResult: HeartbeatFireResult }
> {
  const nowMs = deps.nowMs ?? (() => Date.now());

  let attempt = 0;
  let rateLimitedWaits = 0;
  let lastRateLimitedWallMs: number | undefined;
  while (attempt <= HEARTBEAT_RETRY_BACKOFF_MS.length) {
    try {
      const { txHash } = await deps.heartbeatCaller.callHeartbeat();
      deps.log.info(`heartbeat tx confirmed: ${txHash}`);
      // Read the chain's new nextHeartbeatAtTs after success so runnerStatus
      // doesn't carry the pre-fire (stale) value. Fall back to deps value if
      // the read fails — runnerStatus is observability, not a hot path.
      const nextAfterSuccess = await deps.heartbeatCaller
        .readNextHeartbeatAtTs()
        .catch(() => undefined);
      await postRunnerStatus(deps, {
        runnerId: deps.runnerId,
        lastFireAt: nowMs(),
        lastFireResult: 'success',
        lastFailureMessage: '',
        heartbeatIntervalSeconds: deps.heartbeatIntervalSeconds,
        nextHeartbeatAtTs: nextAfterSuccess ?? deps.nextHeartbeatAtTs,
      });
      return { success: true };
    } catch (err) {
      if (err instanceof HeartbeatRateLimitedError) {
        const lastFailureMessage = messageFrom(err);
        const nextHeartbeatAtTs = await deps.heartbeatCaller
          .readNextHeartbeatAtTs()
          .catch(() => err.nextAllowedAt || deps.nextHeartbeatAtTs);
        deps.log.warn(`heartbeat rate-limited: ${lastFailureMessage}`);
        await postRunnerStatus(deps, {
          runnerId: deps.runnerId,
          lastFireResult: 'rate-limited',
          lastFailureMessage,
          heartbeatIntervalSeconds: deps.heartbeatIntervalSeconds,
          nextHeartbeatAtTs,
        });
        if (rateLimitedWaits >= HEARTBEAT_RATE_LIMIT_RETRY_MAX) {
          return {
            success: false,
            aborted: false,
            message: `${lastFailureMessage}; rate-limit retry cap exceeded`,
            lastFireResult: 'rate-limited',
          };
        }
        rateLimitedWaits++;
        const schedulerNowMs = await prepareHeartbeatWindow({
          deps,
          nextHeartbeatAtTs,
          fallbackNowMs: nowMs,
        });
        const waitMs = computeRateLimitWaitMs({
          deps,
          heartbeatIntervalSeconds: deps.heartbeatIntervalSeconds,
          lastBeatWallMs: deps.lastBeatWallMs,
          lastRateLimitedWallMs,
          nextHeartbeatAtTs,
          schedulerNowMs,
          wallNowMs: nowMs(),
        });
        lastRateLimitedWallMs = nowMs();
        deps.log.info(
          `heartbeat rate-limited; retrying after ${waitMs}ms (nextHeartbeatAtTs=${nextHeartbeatAtTs ?? 'unknown'})`,
        );
        await sleepWithSignal(waitMs, deps.signal);
        if (deps.signal.aborted) return { success: false, aborted: true, message: 'aborted' };
        continue;
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
            lastFireAt: nowMs(),
            lastFireResult: 'success',
            lastFailureMessage: '',
            heartbeatIntervalSeconds: deps.heartbeatIntervalSeconds,
            nextHeartbeatAtTs: nextAfterTimeout,
          });
          writeHeartbeatSuccessFile();
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
      attempt++;
      await sleepWithSignal(backoffMs, deps.signal);
      if (deps.signal.aborted) return { success: false, aborted: true, message: 'aborted' };
    }
  }
  return { success: false, aborted: false, message: 'retry loop exhausted', lastFireResult: 'error' };
}

async function prepareHeartbeatWindow(args: {
  deps: HeartbeatSchedulerDeps & {
    log: NonNullable<HeartbeatSchedulerDeps['log']>;
  };
  nextHeartbeatAtTs: number | undefined;
  fallbackNowMs: () => number;
}): Promise<number> {
  let schedulerNowMs = await readChainNowMs(args.deps, args.fallbackNowMs);
  if (args.nextHeartbeatAtTs === undefined) return schedulerNowMs;

  const targetUnixTs = args.nextHeartbeatAtTs;
  if (schedulerNowMs >= targetUnixTs * 1000) return schedulerNowMs;

  const advanced = await args.deps.heartbeatCaller
    .advanceForkTimeTo?.(targetUnixTs)
    .catch(err => {
      args.deps.log.warn('fork time advance failed; falling back to sleep:', err);
      return false;
    });
  if (!advanced) return schedulerNowMs;

  schedulerNowMs = await readChainNowMs(args.deps, args.fallbackNowMs);
  return schedulerNowMs;
}

function computeForkWallDelayMs(args: {
  heartbeatIntervalSeconds: number | undefined;
  lastBeatWallMs: number | undefined;
  wallNowMs: number;
}): number {
  const intervalMs = (args.heartbeatIntervalSeconds ?? 30) * 1000;
  const lastBeatWallMs = args.lastBeatWallMs ?? args.wallNowMs - intervalMs;
  return computeWallIntervalDelayMs(intervalMs, lastBeatWallMs, args.wallNowMs);
}

function computeRateLimitWaitMs(args: {
  deps: HeartbeatSchedulerDeps;
  heartbeatIntervalSeconds: number | undefined;
  lastBeatWallMs: number | undefined;
  lastRateLimitedWallMs: number | undefined;
  nextHeartbeatAtTs: number | undefined;
  schedulerNowMs: number;
  wallNowMs: number;
}): number {
  if (isForkTimeAdvanceEnabled(args.deps)) {
    const cadenceAnchorWallMs = args.lastRateLimitedWallMs ?? args.wallNowMs;
    return Math.max(
      HEARTBEAT_RATE_LIMIT_RETRY_FLOOR_MS,
      computeForkWallDelayMs({
        heartbeatIntervalSeconds: args.heartbeatIntervalSeconds,
        lastBeatWallMs: cadenceAnchorWallMs,
        wallNowMs: args.wallNowMs,
      }),
    );
  }

  return args.nextHeartbeatAtTs === undefined
    ? HEARTBEAT_RATE_LIMIT_RETRY_FLOOR_MS
    : Math.max(
      HEARTBEAT_RATE_LIMIT_RETRY_FLOOR_MS,
      computeHeartbeatDelayMs(args.nextHeartbeatAtTs, args.schedulerNowMs),
    );
}

async function readSchedulerNowMs(
  deps: HeartbeatSchedulerDeps & {
    log: NonNullable<HeartbeatSchedulerDeps['log']>;
  },
  fallbackNowMs: () => number,
): Promise<number> {
  if (isForkTimeAdvanceEnabled(deps)) return fallbackNowMs();
  return readChainNowMs(deps, fallbackNowMs);
}

async function readChainNowMs(
  deps: HeartbeatSchedulerDeps & {
    log: NonNullable<HeartbeatSchedulerDeps['log']>;
  },
  fallbackNowMs: () => number,
): Promise<number> {
  const readChainNowMs = deps.heartbeatCaller.readChainNowMs;
  if (typeof readChainNowMs !== 'function') return fallbackNowMs();
  try {
    return await readChainNowMs.call(deps.heartbeatCaller);
  } catch (err) {
    deps.log.warn('failed to read chain clock; falling back to local scheduler clock:', err);
    return fallbackNowMs();
  }
}

function isForkTimeAdvanceEnabled(deps: HeartbeatSchedulerDeps): boolean {
  return deps.heartbeatCaller.isForkTimeAdvanceEnabled?.() === true;
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
