import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  computeHeartbeatDelayMs,
  HEARTBEAT_RETRY_BACKOFF_MS,
  startHeartbeatScheduler,
} from '../src/heartbeatScheduler';
import { type IHeartbeatCaller } from '@clan-world/agents/seams';
import { makeSettleLatch } from '../src/settleLatch';

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
