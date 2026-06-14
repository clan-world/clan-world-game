import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  computeHeartbeatDelayMs,
  HEARTBEAT_RETRY_BACKOFF_MS,
  HEARTBEAT_SAFETY_MARGIN_MS,
  startHeartbeatScheduler,
  type ForkTimeAdvancer,
} from '../src/heartbeatScheduler';
import { HeartbeatRateLimitedError, type IHeartbeatCaller } from '@clan-world/agents/seams';

class TestHeartbeatTimeoutError extends Error {
  override name = 'HeartbeatTimeoutError';
}

let heartbeatSuccessDir = '';
let heartbeatSuccessFile = '';

function cleanupHeartbeatSuccessFile(): void {
  if (!heartbeatSuccessFile) return;
  rmSync(heartbeatSuccessFile, { force: true });
  rmSync(`${heartbeatSuccessFile}.${process.pid}.tmp`, { force: true });
}

function makeHeartbeatCaller(
  overrides: Partial<IHeartbeatCaller & ForkTimeAdvancer> = {},
): IHeartbeatCaller & ForkTimeAdvancer {
  return {
    async callHeartbeat() { return { txHash: '0xabc' }; },
    async readHeartbeatIntervalSeconds() { return 60; },
    async readNextHeartbeatAtTs() { return 0; },
    ...overrides,
  };
}

beforeEach(() => {
  heartbeatSuccessDir = mkdtempSync(join(tmpdir(), 'hb-test-'));
  heartbeatSuccessFile = join(heartbeatSuccessDir, 'last-heartbeat-success');
  vi.stubEnv('HEARTBEAT_SUCCESS_FILE_OVERRIDE', heartbeatSuccessFile);
  cleanupHeartbeatSuccessFile();
  vi.useFakeTimers();
});
afterEach(() => {
  cleanupHeartbeatSuccessFile();
  if (heartbeatSuccessDir) rmSync(heartbeatSuccessDir, { recursive: true, force: true });
  heartbeatSuccessDir = '';
  heartbeatSuccessFile = '';
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe('heartbeatScheduler', () => {
  it('computes delay from nextHeartbeatAtTs with a safety margin', () => {
    expect(computeHeartbeatDelayMs(10, 9_250)).toBe(2_250);
    expect(computeHeartbeatDelayMs(10, 11_000)).toBe(500);
    expect(computeHeartbeatDelayMs(10, 12_000)).toBe(0);
  });

  it('does not fire before nextHeartbeatAtTs plus the safety margin', async () => {
    const callHeartbeat = vi.fn().mockResolvedValue({ txHash: '0x1' });
    const caller = makeHeartbeatCaller({
      callHeartbeat,
      async readNextHeartbeatAtTs() { return 10; },
    });
    const abort = new AbortController();

    startHeartbeatScheduler({
      heartbeatCaller: caller,
      signal: abort.signal,
      nowMs: () => 9_250,
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });

    await vi.advanceTimersByTimeAsync(2_249);
    expect(callHeartbeat).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(callHeartbeat).toHaveBeenCalledTimes(1);

    abort.abort();
  });

  it('fires heartbeat when on-chain nextHeartbeatAtTs is due', async () => {
    const callHeartbeat = vi.fn().mockResolvedValue({ txHash: '0x1' });
    let readNextCount = 0;
    const caller = makeHeartbeatCaller({
      callHeartbeat,
      async readNextHeartbeatAtTs() {
        readNextCount++;
        return readNextCount === 2 ? 60 : 0;
      },
    });
    const abort = new AbortController();

    startHeartbeatScheduler({
      heartbeatCaller: caller,
      signal: abort.signal,
      nowMs: () => 0,
    });

    await vi.advanceTimersByTimeAsync(HEARTBEAT_SAFETY_MARGIN_MS + 1);
    expect(callHeartbeat).toHaveBeenCalledTimes(1);

    abort.abort();
  });

  it('retries failed heartbeats with 1s, 2s, 5s, 10s backoff then alerts', async () => {
    const callHeartbeat = vi.fn().mockRejectedValue(new Error('rpc down'));
    const alert = vi.fn().mockResolvedValue({ ok: true });
    const caller = makeHeartbeatCaller({ callHeartbeat });
    const abort = new AbortController();

    startHeartbeatScheduler({
      heartbeatCaller: caller,
      signal: abort.signal,
      nowMs: () => 0,
      alert,
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });

    await vi.advanceTimersByTimeAsync(
      HEARTBEAT_SAFETY_MARGIN_MS + 1 + HEARTBEAT_RETRY_BACKOFF_MS.reduce((sum, ms) => sum + ms, 0),
    );

    expect(callHeartbeat).toHaveBeenCalledTimes(HEARTBEAT_RETRY_BACKOFF_MS.length + 1);
    expect(alert).toHaveBeenCalledTimes(1);

    abort.abort();
  });

  it('waits until nextHeartbeatAtTs plus safety margin after a rate limit without consuming backoff budget', async () => {
    vi.setSystemTime(0);
    const callHeartbeat = vi.fn()
      .mockRejectedValueOnce(new HeartbeatRateLimitedError(3))
      .mockResolvedValueOnce({ txHash: '0x1' });
    const alert = vi.fn().mockResolvedValue({ ok: true });
    const postRunnerStatus = vi.fn().mockResolvedValue(undefined);
    const caller = makeHeartbeatCaller({
      callHeartbeat,
      readNextHeartbeatAtTs: vi.fn()
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(3)
        .mockResolvedValue(33),
    });
    const abort = new AbortController();

    startHeartbeatScheduler({
      heartbeatCaller: caller,
      signal: abort.signal,
      alert,
      convex: { postRunnerStatus },
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });

    await vi.advanceTimersByTimeAsync(HEARTBEAT_SAFETY_MARGIN_MS + 1);

    expect(callHeartbeat).toHaveBeenCalledTimes(1);
    expect(alert).not.toHaveBeenCalled();
    expect(postRunnerStatus).toHaveBeenCalledWith(
      expect.objectContaining({ lastFireResult: 'rate-limited', nextHeartbeatAtTs: 3 }),
    );

    await vi.advanceTimersByTimeAsync(2_998);
    expect(callHeartbeat).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(callHeartbeat).toHaveBeenCalledTimes(2);
    expect(alert).not.toHaveBeenCalled();
    expect(postRunnerStatus).toHaveBeenCalledWith(
      expect.objectContaining({ lastFireResult: 'success', nextHeartbeatAtTs: 33 }),
    );

    abort.abort();
  });

  it('advances fork time before firing when wall time is past due but chain time is behind', async () => {
    vi.setSystemTime(20_000);
    let chainNowMs = 9_000;
    const abort = new AbortController();
    const postRunnerStatus = vi.fn().mockResolvedValue(undefined);
    const advanceForkTimeTo = vi.fn(async (targetUnixTs: number) => {
      chainNowMs = targetUnixTs * 1000;
      return true;
    });
    const callHeartbeat = vi.fn(async () => {
      if (chainNowMs < 10_000 + HEARTBEAT_SAFETY_MARGIN_MS) {
        throw new HeartbeatRateLimitedError(10);
      }
      abort.abort();
      return { txHash: '0x1' };
    });
    const caller = makeHeartbeatCaller({
      callHeartbeat,
      async readChainNowMs() { return chainNowMs; },
      advanceForkTimeTo,
      isForkTimeAdvanceEnabled: () => true,
      readNextHeartbeatAtTs: vi.fn()
        .mockResolvedValueOnce(10)
        .mockResolvedValue(40),
    });

    startHeartbeatScheduler({
      heartbeatCaller: caller,
      signal: abort.signal,
      convex: { postRunnerStatus },
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });

    await vi.advanceTimersByTimeAsync(1);

    expect(advanceForkTimeTo).toHaveBeenCalledWith(12);
    expect(callHeartbeat).toHaveBeenCalledTimes(1);
    expect(postRunnerStatus).toHaveBeenCalledWith(
      expect.objectContaining({ lastFireResult: 'success' }),
    );
  });

  it('does not advance fork time when chain time is already past nextHeartbeatAtTs', async () => {
    vi.setSystemTime(20_000);
    const abort = new AbortController();
    const postRunnerStatus = vi.fn().mockResolvedValue(undefined);
    const advanceForkTimeTo = vi.fn(async () => {
      throw new Error('must not move fork time backward');
    });
    const callHeartbeat = vi.fn(async () => {
      abort.abort();
      return { txHash: '0x1' };
    });
    const caller = makeHeartbeatCaller({
      callHeartbeat,
      async readChainNowMs() { return 13_000; },
      advanceForkTimeTo,
      isForkTimeAdvanceEnabled: () => true,
      readNextHeartbeatAtTs: vi.fn()
        .mockResolvedValueOnce(10)
        .mockResolvedValue(40),
    });

    startHeartbeatScheduler({
      heartbeatCaller: caller,
      signal: abort.signal,
      convex: { postRunnerStatus },
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });

    await vi.advanceTimersByTimeAsync(1);

    expect(advanceForkTimeTo).not.toHaveBeenCalled();
    expect(callHeartbeat).toHaveBeenCalledTimes(1);
    expect(postRunnerStatus).toHaveBeenCalledWith(
      expect.objectContaining({ lastFireResult: 'success' }),
    );
  });

  it('paces fork-advance heartbeats by wall time instead of advanced chain time', async () => {
    vi.setSystemTime(0);
    let chainNowMs = 0;
    let nextHeartbeatAtTs = 30;
    const abort = new AbortController();
    const postRunnerStatus = vi.fn().mockResolvedValue(undefined);
    const advanceForkTimeTo = vi.fn(async (targetUnixTs: number) => {
      chainNowMs = targetUnixTs * 1000;
      return true;
    });
    const callHeartbeat = vi.fn(async () => {
      nextHeartbeatAtTs = 62;
      return { txHash: '0x1' };
    });
    const caller = makeHeartbeatCaller({
      callHeartbeat,
      async readChainNowMs() { return chainNowMs; },
      advanceForkTimeTo,
      isForkTimeAdvanceEnabled: () => true,
      async readNextHeartbeatAtTs() { return nextHeartbeatAtTs; },
    });

    startHeartbeatScheduler({
      heartbeatCaller: caller,
      signal: abort.signal,
      convex: { postRunnerStatus },
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });

    await vi.advanceTimersByTimeAsync(31_499);
    expect(callHeartbeat).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(advanceForkTimeTo).toHaveBeenCalledWith(32);
    expect(callHeartbeat).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(callHeartbeat).toHaveBeenCalledTimes(1);

    abort.abort();
  });

  it('exits silently when aborted during retry sleep', async () => {
    const callHeartbeat = vi.fn().mockRejectedValue(new Error('rpc down'));
    const alert = vi.fn().mockResolvedValue({ ok: true });
    const caller = makeHeartbeatCaller({ callHeartbeat });
    const abort = new AbortController();

    startHeartbeatScheduler({
      heartbeatCaller: caller,
      signal: abort.signal,
      nowMs: () => 0,
      alert,
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });

    await vi.advanceTimersByTimeAsync(HEARTBEAT_SAFETY_MARGIN_MS + 1);
    abort.abort();
    await vi.advanceTimersByTimeAsync(1_000);

    expect(callHeartbeat).toHaveBeenCalledTimes(1);
    expect(alert).not.toHaveBeenCalled();
  });

  it('deduplicates heartbeat failure alerts for five minutes', async () => {
    const callHeartbeat = vi.fn().mockRejectedValue(new Error('rpc down'));
    const alert = vi.fn().mockResolvedValue({ ok: true });
    const caller = makeHeartbeatCaller({ callHeartbeat });
    const abort = new AbortController();

    startHeartbeatScheduler({
      heartbeatCaller: caller,
      signal: abort.signal,
      nowMs: () => 0,
      alert,
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });

    const failureCycleMs =
      HEARTBEAT_SAFETY_MARGIN_MS + 1 + HEARTBEAT_RETRY_BACKOFF_MS.reduce((sum, ms) => sum + ms, 0);
    await vi.advanceTimersByTimeAsync(failureCycleMs);
    await vi.advanceTimersByTimeAsync(failureCycleMs);

    expect(callHeartbeat).toHaveBeenCalledTimes((HEARTBEAT_RETRY_BACKOFF_MS.length + 1) * 2);
    expect(alert).toHaveBeenCalledTimes(1);

    abort.abort();
  });

  it('does not deduplicate heartbeat alerts when alert delivery fails', async () => {
    vi.setSystemTime(0);
    const callHeartbeat = vi.fn().mockRejectedValue(new Error('rpc down'));
    const readNextHeartbeatAtTs = vi.fn()
      .mockResolvedValueOnce(0)
      .mockResolvedValue(120);
    const alert = vi.fn()
      .mockResolvedValueOnce({ ok: false, error: 'telegram down' })
      .mockResolvedValue({ ok: true });
    const caller = makeHeartbeatCaller({ callHeartbeat, readNextHeartbeatAtTs });
    const abort = new AbortController();

    startHeartbeatScheduler({
      heartbeatCaller: caller,
      signal: abort.signal,
      alert,
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });

    const failureCycleMs =
      HEARTBEAT_SAFETY_MARGIN_MS + 1 + HEARTBEAT_RETRY_BACKOFF_MS.reduce((sum, ms) => sum + ms, 0);
    await vi.advanceTimersByTimeAsync(failureCycleMs);
    await vi.advanceTimersByTimeAsync(120_000 - failureCycleMs);
    await vi.advanceTimersByTimeAsync(failureCycleMs);

    expect(alert).toHaveBeenCalledTimes(2);

    abort.abort();
  });

  it('keeps heartbeat failure runnerStatus when Telegram alert delivery fails', async () => {
    const callHeartbeat = vi.fn().mockRejectedValue(new Error('rpc down'));
    const alert = vi.fn().mockResolvedValue({ ok: false, error: 'telegram down' });
    const postRunnerStatus = vi.fn().mockResolvedValue(undefined);
    const caller = makeHeartbeatCaller({ callHeartbeat });
    const abort = new AbortController();

    startHeartbeatScheduler({
      heartbeatCaller: caller,
      signal: abort.signal,
      nowMs: () => 0,
      alert,
      convex: { postRunnerStatus },
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });

    await vi.advanceTimersByTimeAsync(
      HEARTBEAT_SAFETY_MARGIN_MS + 1 + HEARTBEAT_RETRY_BACKOFF_MS.reduce((sum, ms) => sum + ms, 0),
    );

    expect(alert).toHaveBeenCalledTimes(1);
    expect(postRunnerStatus).toHaveBeenCalledTimes(HEARTBEAT_RETRY_BACKOFF_MS.length + 1);
    expect(postRunnerStatus).toHaveBeenLastCalledWith(
      expect.objectContaining({
        lastFireResult: 'error',
        lastFailureMessage: 'rpc down',
      }),
    );
    expect(postRunnerStatus).not.toHaveBeenCalledWith(
      expect.objectContaining({
        lastFailureMessage: 'Telegram alert failed: telegram down',
      }),
    );

    abort.abort();
  });

  it('skips Telegram alert errors when the bot token is intentionally absent', async () => {
    const callHeartbeat = vi.fn().mockRejectedValue(new Error('rpc down'));
    const alert = vi.fn().mockResolvedValue({ ok: false, error: 'TELEGRAM_BOT_TOKEN is not set' });
    const info = vi.fn();
    const error = vi.fn();
    const caller = makeHeartbeatCaller({ callHeartbeat });
    const abort = new AbortController();

    startHeartbeatScheduler({
      heartbeatCaller: caller,
      signal: abort.signal,
      nowMs: () => 0,
      alert,
      log: { info, warn: vi.fn(), error },
    });

    await vi.advanceTimersByTimeAsync(
      HEARTBEAT_SAFETY_MARGIN_MS + 1 + HEARTBEAT_RETRY_BACKOFF_MS.reduce((sum, ms) => sum + ms, 0),
    );

    expect(alert).toHaveBeenCalledTimes(1);
    expect(info).toHaveBeenCalledWith(
      '[heartbeatScheduler] Telegram alert skipped: TELEGRAM_BOT_TOKEN is not set',
    );
    expect(error).not.toHaveBeenCalledWith(
      '[heartbeatScheduler] Telegram alert failed:',
      'TELEGRAM_BOT_TOKEN is not set',
    );

    abort.abort();
  });

  it('does not suppress different heartbeat failure classes inside the dedup window', async () => {
    vi.setSystemTime(0);
    const callHeartbeat = vi.fn()
      .mockRejectedValueOnce(new Error('rpc down'))
      .mockRejectedValueOnce(new Error('rpc down'))
      .mockRejectedValueOnce(new Error('rpc down'))
      .mockRejectedValueOnce(new Error('rpc down'))
      .mockRejectedValueOnce(new Error('rpc down'))
      .mockRejectedValueOnce(new Error('execution reverted: paused'))
      .mockRejectedValueOnce(new Error('execution reverted: paused'))
      .mockRejectedValueOnce(new Error('execution reverted: paused'))
      .mockRejectedValueOnce(new Error('execution reverted: paused'))
      .mockRejectedValueOnce(new Error('execution reverted: paused'));
    const readNextHeartbeatAtTs = vi.fn()
      .mockResolvedValueOnce(0)
      .mockResolvedValue(120);
    const alert = vi.fn().mockResolvedValue({ ok: true });
    const caller = makeHeartbeatCaller({ callHeartbeat, readNextHeartbeatAtTs });
    const abort = new AbortController();

    startHeartbeatScheduler({
      heartbeatCaller: caller,
      signal: abort.signal,
      alert,
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });

    const failureCycleMs =
      HEARTBEAT_SAFETY_MARGIN_MS + 1 + HEARTBEAT_RETRY_BACKOFF_MS.reduce((sum, ms) => sum + ms, 0);
    await vi.advanceTimersByTimeAsync(failureCycleMs);
    await vi.advanceTimersByTimeAsync(120_000 - failureCycleMs);
    await vi.advanceTimersByTimeAsync(failureCycleMs);

    expect(alert).toHaveBeenCalledTimes(2);
    expect(alert.mock.calls[0]?.[0]).toContain('rpc down');
    expect(alert.mock.calls[1]?.[0]).toContain('execution reverted: paused');

    abort.abort();
  });

  it('suppresses same-class heartbeat failure alerts inside the dedup window', async () => {
    vi.setSystemTime(0);
    const callHeartbeat = vi.fn().mockRejectedValue(new Error('rpc down'));
    const readNextHeartbeatAtTs = vi.fn()
      .mockResolvedValueOnce(0)
      .mockResolvedValue(120);
    const alert = vi.fn().mockResolvedValue({ ok: true });
    const caller = makeHeartbeatCaller({ callHeartbeat, readNextHeartbeatAtTs });
    const abort = new AbortController();

    startHeartbeatScheduler({
      heartbeatCaller: caller,
      signal: abort.signal,
      alert,
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });

    const failureCycleMs =
      HEARTBEAT_SAFETY_MARGIN_MS + 1 + HEARTBEAT_RETRY_BACKOFF_MS.reduce((sum, ms) => sum + ms, 0);
    await vi.advanceTimersByTimeAsync(failureCycleMs);
    await vi.advanceTimersByTimeAsync(120_000 - failureCycleMs);
    await vi.advanceTimersByTimeAsync(failureCycleMs);

    expect(alert).toHaveBeenCalledTimes(1);

    abort.abort();
  });

  it('backs off repeated nextHeartbeatAtTs read failures', async () => {
    const callHeartbeat = vi.fn().mockResolvedValue({ txHash: '0x1' });
    const readNextHeartbeatAtTs = vi.fn()
      .mockRejectedValueOnce(new Error('rpc read down 1'))
      .mockRejectedValueOnce(new Error('rpc read down 2'))
      .mockRejectedValueOnce(new Error('rpc read down 3'))
      .mockResolvedValue(60);
    const caller = makeHeartbeatCaller({ callHeartbeat, readNextHeartbeatAtTs });
    const abort = new AbortController();

    startHeartbeatScheduler({
      heartbeatCaller: caller,
      signal: abort.signal,
      nowMs: () => 60_000,
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });

    await vi.advanceTimersByTimeAsync(1_000);
    expect(readNextHeartbeatAtTs).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1_999);
    expect(readNextHeartbeatAtTs).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(readNextHeartbeatAtTs).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(4_999);
    expect(readNextHeartbeatAtTs).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(1);
    expect(readNextHeartbeatAtTs).toHaveBeenCalledTimes(4);

    abort.abort();
  });

  it('re-reads nextHeartbeatAtTs after receipt timeout and treats advanced state as success', async () => {
    vi.setSystemTime(100_000);
    const callHeartbeat = vi.fn().mockRejectedValue(new TestHeartbeatTimeoutError('receipt timed out'));
    const alert = vi.fn().mockResolvedValue({ ok: true });
    const postRunnerStatus = vi.fn().mockResolvedValue(undefined);
    const readNextHeartbeatAtTs = vi.fn()
      .mockResolvedValueOnce(100)
      .mockResolvedValueOnce(160)
      .mockResolvedValue(220);
    const caller = makeHeartbeatCaller({ callHeartbeat, readNextHeartbeatAtTs });
    const abort = new AbortController();

    startHeartbeatScheduler({
      heartbeatCaller: caller,
      signal: abort.signal,
      nowMs: () => 100_000,
      alert,
      convex: { postRunnerStatus },
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });

    await vi.advanceTimersByTimeAsync(HEARTBEAT_SAFETY_MARGIN_MS + 1);

    expect(callHeartbeat).toHaveBeenCalledTimes(1);
    expect(alert).not.toHaveBeenCalled();
    expect(postRunnerStatus).toHaveBeenCalledWith(
      expect.objectContaining({ lastFireResult: 'success', nextHeartbeatAtTs: 160 }),
    );
    expect(existsSync(heartbeatSuccessFile)).toBe(true);
    expect(readFileSync(heartbeatSuccessFile, 'utf8')).toBe('101');

    abort.abort();
  });

  it('swallows runnerStatus write failures and keeps scheduling', async () => {
    const callHeartbeat = vi.fn().mockResolvedValue({ txHash: '0x1' });
    const postRunnerStatus = vi.fn().mockRejectedValue(new Error('convex down'));
    const caller = makeHeartbeatCaller({
      callHeartbeat,
      async readNextHeartbeatAtTs() { return 0; },
    });
    const abort = new AbortController();

    startHeartbeatScheduler({
      heartbeatCaller: caller,
      signal: abort.signal,
      nowMs: () => 0,
      convex: { postRunnerStatus },
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });

    await vi.advanceTimersByTimeAsync(4_002);

    expect(postRunnerStatus).toHaveBeenCalled();
    expect(callHeartbeat).toHaveBeenCalledTimes(2);

    abort.abort();
  });

  it('uses nowMs override for successful runnerStatus lastFireAt', async () => {
    const callHeartbeat = vi.fn().mockResolvedValue({ txHash: '0x1' });
    const postRunnerStatus = vi.fn().mockResolvedValue(undefined);
    let readNextCount = 0;
    const caller = makeHeartbeatCaller({
      callHeartbeat,
      async readNextHeartbeatAtTs() {
        readNextCount++;
        return readNextCount === 2 ? 60 : 0;
      },
    });
    const abort = new AbortController();

    startHeartbeatScheduler({
      heartbeatCaller: caller,
      signal: abort.signal,
      nowMs: () => 123_456,
      convex: { postRunnerStatus },
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });

    await vi.advanceTimersByTimeAsync(HEARTBEAT_SAFETY_MARGIN_MS + 1);

    expect(postRunnerStatus).toHaveBeenCalledWith(
      expect.objectContaining({ lastFireAt: 123_456, lastFireResult: 'success' }),
    );

    abort.abort();
  });

  it('keeps firing due heartbeats without waiting for Cycle B state', async () => {
    const callHeartbeat = vi.fn().mockResolvedValue({ txHash: '0x1' });
    const caller = makeHeartbeatCaller({
      callHeartbeat,
      async readNextHeartbeatAtTs() { return 0; },
    });
    const abort = new AbortController();

    startHeartbeatScheduler({
      heartbeatCaller: caller,
      signal: abort.signal,
      nowMs: () => 0,
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });

    await vi.advanceTimersByTimeAsync(HEARTBEAT_SAFETY_MARGIN_MS + 1);
    expect(callHeartbeat).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(2_501);
    expect(callHeartbeat).toHaveBeenCalledTimes(2);

    abort.abort();
  });

  it('guards successful no-op heartbeats whose nextHeartbeatAtTs remains in the past', async () => {
    const callHeartbeat = vi.fn().mockResolvedValue({ txHash: '0x1' });
    let nextReads = 0;
    const caller = makeHeartbeatCaller({
      callHeartbeat,
      async readNextHeartbeatAtTs() {
        nextReads++;
        return nextReads <= 2 ? 0 : 60;
      },
    });
    const abort = new AbortController();

    startHeartbeatScheduler({
      heartbeatCaller: caller,
      signal: abort.signal,
      nowMs: () => 2_000,
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });

    await vi.advanceTimersByTimeAsync(HEARTBEAT_SAFETY_MARGIN_MS + 1);
    expect(callHeartbeat).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(999);
    expect(callHeartbeat).toHaveBeenCalledTimes(1);

    abort.abort();
  });
});
