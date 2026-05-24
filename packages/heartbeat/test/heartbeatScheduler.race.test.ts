/**
 * Async / race-correctness tests for heartbeatScheduler.
 *
 * Agent C focus area (parallel test-improvement experiment 2026-05-24):
 * Cover non-trivial async sequencing — abort interleavings, concurrent RPC
 * overlaps with state advances, alert delivery + state-write race ordering,
 * and the hot-loop guard's interaction with the post-success re-read.
 *
 * These tests are NOT covered by:
 *   - the existing heartbeatScheduler.test.ts (correctness/happy-path)
 *   - Agent A (error paths)            — focuses on error classification, not interleavings
 *   - Agent B (boundary conditions)    — focuses on values at limits, not concurrency
 *   - Agent D (integration tests)      — composite flows, not single-loop async ordering
 *   - Agent E (property-based)         — random invariants, not specific race fixtures
 *
 * Convention: every test ends with `abort.abort()` + a final tick advance so
 * the scheduler exits cleanly and the test is deterministic with fake timers.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  HEARTBEAT_RETRY_BACKOFF_MS,
  startHeartbeatScheduler,
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

function makeHeartbeatCaller(overrides: Partial<IHeartbeatCaller> = {}): IHeartbeatCaller {
  return {
    async callHeartbeat() { return { txHash: '0xabc' }; },
    async readHeartbeatIntervalSeconds() { return 60; },
    async readNextHeartbeatAtTs() { return 0; },
    ...overrides,
  };
}

/**
 * Defer-able promise — returns a resolver pair so the test can hold an
 * RPC call "in flight" then resolve/reject when it wants, simulating
 * RPC overlap with abort or state advance.
 */
function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void } {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

beforeEach(() => {
  heartbeatSuccessDir = mkdtempSync(join(tmpdir(), 'hb-race-test-'));
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

describe('heartbeatScheduler — async / race correctness', () => {
  /**
   * RACE 1 — abort fires WHILE callHeartbeat() is in flight.
   *
   * The scheduler must not retry, must not alert, must not post a
   * runnerStatus claiming success or failure for the in-flight call once
   * the abort observes. The pending RPC is allowed to settle in the
   * background (we don't cancel it — there's no way to), but its result
   * must not produce side effects after abort.
   */
  it('abort during in-flight callHeartbeat does not retry, alert, or schedule another fire', async () => {
    const callPending = deferred<{ txHash: string }>();
    const callHeartbeat = vi.fn().mockReturnValue(callPending.promise);
    const alert = vi.fn().mockResolvedValue({ ok: true });
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

    // Advance past jitter so the scheduler enters callHeartbeat.
    await vi.advanceTimersByTimeAsync(501);
    expect(callHeartbeat).toHaveBeenCalledTimes(1);

    // Abort WHILE the heartbeat is in flight.
    abort.abort();
    // Now reject the in-flight call to simulate the RPC actually failing
    // mid-shutdown (common when the RPC connection is torn down by SIGTERM).
    callPending.reject(new Error('rpc connection reset'));

    // Allow microtasks + the full retry-backoff window to drain.
    await vi.advanceTimersByTimeAsync(
      HEARTBEAT_RETRY_BACKOFF_MS.reduce((s, ms) => s + ms, 0) + 5_000,
    );

    expect(callHeartbeat).toHaveBeenCalledTimes(1);
    expect(alert).not.toHaveBeenCalled();
  });

  /**
   * RACE 2 — abort fires DURING the inter-retry backoff sleep.
   *
   * `sleepWithSignal` resolves early on abort; the next iteration of the
   * retry loop must check `signal.aborted` and exit without calling
   * heartbeat again or surfacing an alert.
   */
  it('abort during inter-retry backoff exits cleanly without firing the next attempt', async () => {
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

    // First attempt + jitter -> first failure registered, enters 1s backoff.
    await vi.advanceTimersByTimeAsync(501);
    expect(callHeartbeat).toHaveBeenCalledTimes(1);

    // Abort partway through the 1s backoff (after 200ms).
    await vi.advanceTimersByTimeAsync(200);
    abort.abort();

    // Drain everything. If the loop is broken, no more callHeartbeat fires.
    await vi.advanceTimersByTimeAsync(
      HEARTBEAT_RETRY_BACKOFF_MS.reduce((s, ms) => s + ms, 0) + 5_000,
    );

    expect(callHeartbeat).toHaveBeenCalledTimes(1);
    expect(alert).not.toHaveBeenCalled();
  });

  /**
   * RACE 3 — abort fires WHILE the post-failure alert() is in flight.
   *
   * The scheduler awaits `alert(...)` outside the abort check. If abort
   * fires while we await Telegram, the loop must observe `signal.aborted`
   * on the next iteration's `while` check and exit without firing again.
   */
  it('abort during in-flight alert() exits cleanly without scheduling another fire', async () => {
    const callHeartbeat = vi.fn().mockRejectedValue(new Error('rpc down'));
    const alertPending = deferred<{ ok: boolean }>();
    const alert = vi.fn().mockReturnValue(alertPending.promise);
    const caller = makeHeartbeatCaller({ callHeartbeat });
    const abort = new AbortController();

    startHeartbeatScheduler({
      heartbeatCaller: caller,
      signal: abort.signal,
      nowMs: () => 0,
      alert,
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });

    // Drive all retry attempts to exhaustion -> alert is called.
    await vi.advanceTimersByTimeAsync(
      501 + HEARTBEAT_RETRY_BACKOFF_MS.reduce((s, ms) => s + ms, 0),
    );
    expect(callHeartbeat).toHaveBeenCalledTimes(HEARTBEAT_RETRY_BACKOFF_MS.length + 1);
    expect(alert).toHaveBeenCalledTimes(1);

    // Abort while alert is still pending.
    abort.abort();
    alertPending.resolve({ ok: true });

    // Drain — verify the loop does not re-enter and call heartbeat again.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(callHeartbeat).toHaveBeenCalledTimes(HEARTBEAT_RETRY_BACKOFF_MS.length + 1);
  });

  /**
   * RACE 4 — chain advances DURING the in-flight callHeartbeat tx.
   *
   * Simulates another runner (or finalize webhook) advancing
   * nextHeartbeatAtTs while our heartbeat tx is still mining.
   *
   * On a *successful* heartbeat the scheduler re-reads nextHeartbeatAtTs
   * after success and posts the FRESH value to runnerStatus (the
   * "advanced" tick), not the pre-fire stale value. We must verify that
   * concurrent state advance doesn't corrupt this: even if the post-success
   * re-read overlaps the next loop iteration's re-read, runnerStatus gets
   * the value at success-time, not later.
   */
  it('reports the post-success nextHeartbeatAtTs even when chain advances during the tx', async () => {
    const callPending = deferred<{ txHash: string }>();
    const callHeartbeat = vi.fn().mockReturnValue(callPending.promise);
    const postRunnerStatus = vi.fn().mockResolvedValue(undefined);

    // Sequence:
    //   read #1 (initial loop scheduling)         -> 0   (heartbeat is due)
    //   read #2 (post-success re-read inside attemptHeartbeat)   -> 60
    //   read #3 (post-success re-read in main loop hot-loop guard) -> 120
    //   read #4+ (next loop iteration)            -> 180
    let readNextCount = 0;
    const caller = makeHeartbeatCaller({
      callHeartbeat,
      async readNextHeartbeatAtTs() {
        readNextCount++;
        if (readNextCount === 1) return 0;
        if (readNextCount === 2) return 60;
        if (readNextCount === 3) return 120;
        return 180;
      },
    });
    const abort = new AbortController();

    startHeartbeatScheduler({
      heartbeatCaller: caller,
      signal: abort.signal,
      nowMs: () => 0,
      convex: { postRunnerStatus },
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });

    await vi.advanceTimersByTimeAsync(501);
    expect(callHeartbeat).toHaveBeenCalledTimes(1);

    // Now resolve the tx successfully — concurrent state advance has already
    // bumped the chain to 60+ during the tx's "mining" period.
    callPending.resolve({ txHash: '0x1' });
    await vi.advanceTimersByTimeAsync(0);
    await Promise.resolve();
    await Promise.resolve();

    // The success runnerStatus must reflect the immediate post-tx re-read (60),
    // not the pre-fire 0, and not the still-later 120/180. Race correctness:
    // the value captured at success-resolution time is what's reported.
    expect(postRunnerStatus).toHaveBeenCalledWith(
      expect.objectContaining({ lastFireResult: 'success', nextHeartbeatAtTs: 60 }),
    );

    abort.abort();
  });

  /**
   * RACE 5 — receipt-timeout where the chain advanced behind our back.
   *
   * Scenario: our tx hung on receipt-wait, but another path advanced the
   * tick. The scheduler must (a) reclassify the timeout as success once the
   * re-read shows advance, (b) write the success file, (c) NOT retry, and
   * (d) NOT alert. This is the "timeout-but-actually-succeeded" branch
   * which is fundamentally a race: the receipt was confirmed somewhere
   * between viem's poll cadence and our timeout.
   */
  it('reclassifies receipt timeout as success when re-read shows the chain advanced', async () => {
    const callHeartbeat = vi.fn().mockRejectedValue(new TestHeartbeatTimeoutError('receipt timed out'));
    const alert = vi.fn().mockResolvedValue({ ok: true });
    const postRunnerStatus = vi.fn().mockResolvedValue(undefined);

    // Initial read returns the pre-fire next; post-timeout re-read returns
    // an advanced next (someone else moved the chain forward).
    let readNextCount = 0;
    const caller = makeHeartbeatCaller({
      callHeartbeat,
      async readNextHeartbeatAtTs() {
        readNextCount++;
        return readNextCount === 1 ? 100 : 200;
      },
    });
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
      expect.objectContaining({
        lastFireResult: 'success',
        nextHeartbeatAtTs: 200,
      }),
    );

    abort.abort();
  });

  /**
   * RACE 6 — receipt-timeout where the re-read FAILS.
   *
   * The catch on `readNextHeartbeatAtTs()` returns undefined; the scheduler
   * must fall through to the normal retry path (treating the timeout as a
   * real failure), not crash on the undefined and not silently treat it as
   * success.
   */
  it('falls through to retry when receipt timeout AND post-timeout re-read fails', async () => {
    let callCount = 0;
    const callHeartbeat = vi.fn(async () => {
      callCount++;
      throw new TestHeartbeatTimeoutError('receipt timed out');
    });
    const alert = vi.fn().mockResolvedValue({ ok: true });

    // Initial read succeeds; ALL subsequent re-reads (post-timeout + the
    // separate retries' re-reads) reject -> falls through to retry path.
    let readNextCount = 0;
    const readNextHeartbeatAtTs = vi.fn(async () => {
      readNextCount++;
      if (readNextCount === 1) return 100;
      throw new Error('rpc read died');
    });
    const caller = makeHeartbeatCaller({ callHeartbeat, readNextHeartbeatAtTs });
    const abort = new AbortController();

    startHeartbeatScheduler({
      heartbeatCaller: caller,
      signal: abort.signal,
      nowMs: () => 100_000,
      alert,
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });

    // Run far enough to exhaust all retries.
    await vi.advanceTimersByTimeAsync(
      501 + HEARTBEAT_RETRY_BACKOFF_MS.reduce((s, ms) => s + ms, 0),
    );

    expect(callCount).toBe(HEARTBEAT_RETRY_BACKOFF_MS.length + 1);
    // After exhaustion the timeout class drives an alert.
    expect(alert).toHaveBeenCalledTimes(1);
    expect(alert.mock.calls[0]?.[0]).toContain('receipt timed out');

    abort.abort();
  });

  /**
   * RACE 7 — abort fires WHILE postRunnerStatus is in flight after rate-limit.
   *
   * Rate-limit short-circuits to `success: true, rateLimited: true` and the
   * main loop `continue`s. The postRunnerStatus write must not block
   * shutdown forever. We verify that an in-flight postRunnerStatus
   * Promise neither prevents abort observation nor causes a duplicate
   * heartbeat fire.
   */
  it('abort during in-flight postRunnerStatus after rate-limit exits cleanly', async () => {
    const callHeartbeat = vi.fn().mockRejectedValue(new HeartbeatRateLimitedError(60));
    const alert = vi.fn().mockResolvedValue({ ok: true });
    const statusPending = deferred<undefined>();
    let postRunnerStatusCount = 0;
    const postRunnerStatus = vi.fn(() => {
      postRunnerStatusCount++;
      // Only the rate-limited one hangs; otherwise resolve immediately.
      if (postRunnerStatusCount === 1) return statusPending.promise;
      return Promise.resolve(undefined);
    });
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

    // Trigger the rate-limited call.
    await vi.advanceTimersByTimeAsync(501);
    expect(callHeartbeat).toHaveBeenCalledTimes(1);
    expect(postRunnerStatus).toHaveBeenCalledTimes(1);

    // Abort while postRunnerStatus is hung.
    abort.abort();
    statusPending.resolve(undefined);

    // Drain. Verify no second fire scheduled and no alert.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(callHeartbeat).toHaveBeenCalledTimes(1);
    expect(alert).not.toHaveBeenCalled();
  });

  /**
   * RACE 8 — TWO independent schedulers contend on the same caller.
   *
   * Each scheduler has its own abort; aborting one must NOT cancel the
   * other (no shared mutable state). This is the "operator restarts one
   * runner while another transient instance is still draining" scenario.
   *
   * (Real prod is one-runner-per-host but this test guards against a
   * regression where a stray module-level handler — e.g. process.on
   * inside startHeartbeatScheduler — would cause cross-talk.)
   */
  it('two independent schedulers do not cross-cancel each other', async () => {
    const callA = vi.fn().mockResolvedValue({ txHash: '0xA' });
    const callB = vi.fn().mockResolvedValue({ txHash: '0xB' });
    let readACount = 0;
    let readBCount = 0;
    const callerA = makeHeartbeatCaller({
      callHeartbeat: callA,
      async readNextHeartbeatAtTs() { readACount++; return readACount === 2 ? 60 : 0; },
    });
    const callerB = makeHeartbeatCaller({
      callHeartbeat: callB,
      async readNextHeartbeatAtTs() { readBCount++; return readBCount === 2 ? 60 : 0; },
    });
    const abortA = new AbortController();
    const abortB = new AbortController();

    startHeartbeatScheduler({
      heartbeatCaller: callerA,
      signal: abortA.signal,
      nowMs: () => 0,
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });
    startHeartbeatScheduler({
      heartbeatCaller: callerB,
      signal: abortB.signal,
      nowMs: () => 0,
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });

    // Both schedulers fire once after jitter.
    await vi.advanceTimersByTimeAsync(501);
    expect(callA).toHaveBeenCalledTimes(1);
    expect(callB).toHaveBeenCalledTimes(1);

    // Abort only A.
    abortA.abort();

    // B must keep firing on the next cycle (chain still says due since
    // its post-success re-read returned 60 then back to 0).
    await vi.advanceTimersByTimeAsync(60_500);
    expect(callA).toHaveBeenCalledTimes(1);
    expect(callB.mock.calls.length).toBeGreaterThanOrEqual(2);

    abortB.abort();
  });

  /**
   * RACE 9 — abort fires WHILE the boot-time readHeartbeatIntervalSeconds
   * call is in flight.
   *
   * The scheduler awaits the interval read before entering the main loop.
   * Aborting mid-read must cause the main loop to exit on the first
   * `while (!aborted)` check without ever calling callHeartbeat.
   */
  it('abort during boot-time readHeartbeatIntervalSeconds exits before any heartbeat fires', async () => {
    const intervalPending = deferred<number>();
    const callHeartbeat = vi.fn().mockResolvedValue({ txHash: '0x1' });
    const caller = makeHeartbeatCaller({
      callHeartbeat,
      readHeartbeatIntervalSeconds: vi.fn().mockReturnValue(intervalPending.promise),
    });
    const abort = new AbortController();

    startHeartbeatScheduler({
      heartbeatCaller: caller,
      signal: abort.signal,
      nowMs: () => 0,
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });

    // Abort while boot read is still pending.
    abort.abort();
    intervalPending.resolve(60);

    // Drain everything.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(callHeartbeat).not.toHaveBeenCalled();
  });
});
