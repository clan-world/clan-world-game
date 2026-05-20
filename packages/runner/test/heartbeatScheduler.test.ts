import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  computeHeartbeatDelayMs,
  HEARTBEAT_RETRY_BACKOFF_MS,
  startHeartbeatScheduler,
} from '../src/heartbeatScheduler';
import { HeartbeatRateLimitedError, type IHeartbeatCaller } from '@clan-world/agents/seams';
import { makeSettleLatch } from '../src/settleLatch';
import { makeConvexSnapshotSettleLatch } from '../src/convexSnapshotSettleLatch';
import { HeartbeatTimeoutError } from '../src/runnerCastHeartbeat';
import type { WorldSnapshot } from '@clan-world/shared';

function makeHeartbeatCaller(overrides: Partial<IHeartbeatCaller> = {}): IHeartbeatCaller {
  return {
    async callHeartbeat() { return { txHash: '0xabc' }; },
    async readHeartbeatIntervalSeconds() { return 60; },
    async readNextHeartbeatAtTs() { return 0; },
    ...overrides,
  };
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('heartbeatScheduler', () => {
  it('computes delay from nextHeartbeatAtTs with 500ms jitter', () => {
    expect(computeHeartbeatDelayMs(10, 9_250)).toBe(1_250);
    expect(computeHeartbeatDelayMs(10, 11_000)).toBe(500);
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

    await vi.advanceTimersByTimeAsync(501);
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
      501 + HEARTBEAT_RETRY_BACKOFF_MS.reduce((sum, ms) => sum + ms, 0),
    );

    expect(callHeartbeat).toHaveBeenCalledTimes(HEARTBEAT_RETRY_BACKOFF_MS.length + 1);
    expect(alert).toHaveBeenCalledTimes(1);

    abort.abort();
  });

  it('treats rate-limited heartbeats as settled without retrying or alerting', async () => {
    const callHeartbeat = vi.fn().mockRejectedValue(new HeartbeatRateLimitedError(60));
    const alert = vi.fn().mockResolvedValue({ ok: true });
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
      nowMs: () => 0,
      alert,
      convex: { postRunnerStatus },
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });

    await vi.advanceTimersByTimeAsync(501);

    expect(callHeartbeat).toHaveBeenCalledTimes(1);
    expect(alert).not.toHaveBeenCalled();
    expect(postRunnerStatus).toHaveBeenCalledWith(
      expect.objectContaining({ lastFireResult: 'rate-limited' }),
    );

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

    await vi.advanceTimersByTimeAsync(501);
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
      501 + HEARTBEAT_RETRY_BACKOFF_MS.reduce((sum, ms) => sum + ms, 0);
    await vi.advanceTimersByTimeAsync(failureCycleMs);
    await vi.advanceTimersByTimeAsync(failureCycleMs);

    expect(callHeartbeat).toHaveBeenCalledTimes((HEARTBEAT_RETRY_BACKOFF_MS.length + 1) * 2);
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
    const callHeartbeat = vi.fn().mockRejectedValue(new HeartbeatTimeoutError('receipt timed out'));
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

    await vi.advanceTimersByTimeAsync(501);

    expect(callHeartbeat).toHaveBeenCalledTimes(1);
    expect(alert).not.toHaveBeenCalled();
    expect(postRunnerStatus).toHaveBeenCalledWith(
      expect.objectContaining({ lastFireResult: 'success', nextHeartbeatAtTs: 160 }),
    );

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

    await vi.advanceTimersByTimeAsync(2_002);

    expect(postRunnerStatus).toHaveBeenCalled();
    expect(callHeartbeat).toHaveBeenCalledTimes(2);

    abort.abort();
  });

  it('waits for Cycle B settle latch before firing', async () => {
    const callHeartbeat = vi.fn().mockResolvedValue({ txHash: '0x1' });
    const caller = makeHeartbeatCaller({
      callHeartbeat,
      async readNextHeartbeatAtTs() { return 0; },
    });
    const abort = new AbortController();
    const settleLatch = makeSettleLatch();

    startHeartbeatScheduler({
      heartbeatCaller: caller,
      signal: abort.signal,
      nowMs: () => 0,
      settleLatch,
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });

    await vi.advanceTimersByTimeAsync(501);
    expect(callHeartbeat).not.toHaveBeenCalled();

    settleLatch.markSettled(1);
    await vi.advanceTimersByTimeAsync(1_501);
    expect(callHeartbeat).toHaveBeenCalledTimes(1);

    abort.abort();
  });

  it('standalone snapshot latch waits for worldSnapshot.tick to advance before the next fire', async () => {
    let snapshotTick = 0;
    const getSnapshot = vi.fn(async () => makeSnapshot(snapshotTick));
    const callHeartbeat = vi.fn().mockResolvedValue({ txHash: '0x1' });
    const readNextHeartbeatAtTs = vi.fn().mockResolvedValue(0);
    const caller = makeHeartbeatCaller({ callHeartbeat, readNextHeartbeatAtTs });
    const abort = new AbortController();
    const settleLatch = makeConvexSnapshotSettleLatch({
      convex: { getSnapshot },
      signal: abort.signal,
      log: { warn: vi.fn() },
      pollMs: 100,
    });

    startHeartbeatScheduler({
      heartbeatCaller: caller,
      signal: abort.signal,
      nowMs: () => 0,
      settleLatch,
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });

    await vi.advanceTimersByTimeAsync(501);
    expect(callHeartbeat).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(2_000);
    expect(callHeartbeat).toHaveBeenCalledTimes(1);

    snapshotTick = 1;
    await vi.advanceTimersByTimeAsync(2_000);
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

    await vi.advanceTimersByTimeAsync(501);
    expect(callHeartbeat).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(999);
    expect(callHeartbeat).toHaveBeenCalledTimes(1);

    abort.abort();
  });
});

function makeSnapshot(tick: number): WorldSnapshot {
  return {
    tick,
    heartbeatIntervalSeconds: 60,
    tickEpoch: { startedAt: 0, durationMs: 60_000 },
    regions: [],
    clans: [],
  };
}
