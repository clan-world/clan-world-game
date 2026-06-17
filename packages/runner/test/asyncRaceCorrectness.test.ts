// Async / race-correctness coverage for the runner.
//
// These tests target failure modes that pure unit-tests on individual
// functions don't reach: signal.aborted firing in the middle of multi-step
// operations, queue ordering inside the watchAuxiliary async iterator,
// abort-listener cleanup in sleep(), and the file-lock contention contract
// of flockGuard.
//
// Agent C — 2026-05-24 parallel test-improvement experiment.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RunnerConvexClient } from "../src/convexClient.js";
import { deliverMessage, deliverPendingOnly } from "../src/messageDelivery.js";
import { acquireFlock } from "../src/flockGuard.js";
import { sleep, withBackoff } from "../src/retry.js";
import {
  postPasteSubmitted,
  POST_PASTE_INITIAL_SETTLE_MS,
  STUCK_INPUT_MAX_RETRIES,
  STUCK_INPUT_RETRY_DELAY_MS,
} from "../src/pasteVerification.js";
import type { RunnerAuxiliary, PendingMessage } from "../src/types.js";

// -----------------------------------------------------------------------------
// 1. watchAuxiliary — async iterator queue / signal-coupling tests
// -----------------------------------------------------------------------------

describe("watchAuxiliary async iterator (race correctness)", () => {
  it("delivers multiple updates in FIFO order when pushes burst between awaits", async () => {
    // Pushes can stack up while the consumer is processing the previous value.
    // The shift()-based queue must preserve insertion order — if it ever
    // regressed to e.g. "drop all but newest", we'd silently miss
    // pendingMessages or tick-clock advances.
    const client = new RunnerConvexClient("http://localhost:3210", "elder-1", "secret");
    let onValue: ((value: any) => void) | undefined;
    (client as any).live = {
      onUpdate(_ref: unknown, _payload: any, valueCb: (value: any) => void) {
        onValue = valueCb;
        return () => {};
      },
      close() {},
    };

    const ac = new AbortController();
    const iterator = client.watchAuxiliary(ac.signal)[Symbol.asyncIterator]();

    // Kick the generator so it runs onUpdate and registers the callback.
    const firstPending = iterator.next();
    // The generator captures the wake promise; flush microtasks so the
    // synchronous portion (live.onUpdate) has executed.
    await flushMicrotasks();
    expect(onValue).toBeDefined();

    // Burst three updates BEFORE we await the next-after-current.
    onValue!(aux(1));
    onValue!(aux(2));
    onValue!(aux(3));

    const first = await firstPending;
    const second = await iterator.next();
    const third = await iterator.next();
    expect((first.value as RunnerAuxiliary).tickClock.tick).toBe(1);
    expect((second.value as RunnerAuxiliary).tickClock.tick).toBe(2);
    expect((third.value as RunnerAuxiliary).tickClock.tick).toBe(3);

    ac.abort();
    await iterator.return?.();
  });

  it("queues updates pushed while the consumer is awaiting and delivers them on next iteration", async () => {
    // Reproduces the steady-state case where push() runs while the consumer
    // is mid-await on the wake promise.
    const client = new RunnerConvexClient("http://localhost:3210", "elder-1", "secret");
    let onValue: ((value: any) => void) | undefined;
    (client as any).live = {
      onUpdate(_ref: unknown, _payload: any, valueCb: (value: any) => void) {
        onValue = valueCb;
        return () => {};
      },
      close() {},
    };

    const ac = new AbortController();
    const iterator = client.watchAuxiliary(ac.signal)[Symbol.asyncIterator]();
    const firstPending = iterator.next();
    await flushMicrotasks();
    expect(onValue).toBeDefined();

    onValue!(aux(10));
    const first = await firstPending;
    expect((first.value as RunnerAuxiliary).tickClock.tick).toBe(10);

    // Now the iterator is awaiting on `wake` — push two values that should
    // wake it AND remain queued for the subsequent .next() call.
    const secondPromise = iterator.next();
    onValue!(aux(11));
    onValue!(aux(12));
    const second = await secondPromise;
    expect((second.value as RunnerAuxiliary).tickClock.tick).toBe(11);

    const third = await iterator.next();
    expect((third.value as RunnerAuxiliary).tickClock.tick).toBe(12);

    ac.abort();
    await iterator.return?.();
  });

  it("exits cleanly when abort fires while the iterator is awaiting (no value pending)", async () => {
    // The wakeOnAbort listener must unblock the awaiting Promise so the loop
    // can check signal.aborted and break out — otherwise the iterator leaks
    // and the runner can't shut down on SIGTERM.
    const client = new RunnerConvexClient("http://localhost:3210", "elder-1", "secret");
    let unsubscribeCalled = false;
    (client as any).live = {
      onUpdate() { return () => { unsubscribeCalled = true; }; },
      close() {},
    };

    const ac = new AbortController();
    const iterator = client.watchAuxiliary(ac.signal)[Symbol.asyncIterator]();
    const next = iterator.next();
    // Abort while consumer is mid-await — must wake and resolve done=true.
    ac.abort();
    const result = await next;
    expect(result.done).toBe(true);
    expect(unsubscribeCalled).toBe(true);
  });

  it("removes the abort listener after teardown (no listener leak across iterations)", async () => {
    // Regression guard: signal.removeEventListener("abort", wakeOnAbort) in
    // the finally block must run, otherwise repeated watchAuxiliary calls
    // would accumulate listeners on the same signal.
    const client = new RunnerConvexClient("http://localhost:3210", "elder-1", "secret");
    (client as any).live = {
      onUpdate() { return () => {}; },
      close() {},
    };

    const ac = new AbortController();
    // Track how many abort listeners are attached at any moment.
    const original = ac.signal.addEventListener.bind(ac.signal);
    const removed = vi.fn();
    let attached = 0;
    (ac.signal as any).addEventListener = (type: string, listener: any, opts?: any) => {
      if (type === "abort") attached++;
      return original(type, listener, opts);
    };
    const originalRemove = ac.signal.removeEventListener.bind(ac.signal);
    (ac.signal as any).removeEventListener = (type: string, listener: any) => {
      if (type === "abort") { attached--; removed(); }
      return originalRemove(type, listener);
    };

    const iterator = client.watchAuxiliary(ac.signal)[Symbol.asyncIterator]();
    const pending = iterator.next();
    ac.abort();
    await pending;

    expect(removed).toHaveBeenCalled();
    expect(attached).toBeLessThanOrEqual(0);
  });

  it("recovers from a subscription error by yielding a fresh getAuxiliary result", async () => {
    // When the live subscription pushes an Error, the iterator falls back to
    // self.getAuxiliary(signal). If that fallback throws, the entire runner
    // crashes — but we DO want it to recover when the fallback succeeds.
    const client = new RunnerConvexClient("http://localhost:3210", "elder-1", "secret");
    let onValue: ((value: any) => void) | undefined;
    let onError: ((err: Error) => void) | undefined;
    (client as any).live = {
      onUpdate(_ref: unknown, _payload: any, valueCb: (value: any) => void, errCb: (err: Error) => void) {
        onValue = valueCb;
        onError = errCb;
        return () => {};
      },
      close() {},
    };
    (client as any).http = {
      async query() { return aux(99); },
    };

    const ac = new AbortController();
    const iterator = client.watchAuxiliary(ac.signal)[Symbol.asyncIterator]();
    const pending = iterator.next();
    await flushMicrotasks();
    expect(onError).toBeDefined();
    expect(onValue).toBeDefined();
    onError!(new Error("subscription dropped"));
    const result = await pending;
    expect((result.value as RunnerAuxiliary).tickClock.tick).toBe(99);

    ac.abort();
    await iterator.return?.();
  });
});

// -----------------------------------------------------------------------------
// 2. deliverMessage — signal & consume-gap correctness
// -----------------------------------------------------------------------------

describe("deliverMessage signal / consume-gap correctness", () => {
  it("throws aborted before any paste when signal already fired (no recordTickSend reissue)", async () => {
    // Pre-abort: the first throwIfAborted at attempt=1 must fire BEFORE we
    // touch tmux. This protects against double-pastes when SIGTERM races
    // with a freshly-scheduled tick handler.
    const ac = new AbortController();
    ac.abort();
    const convex = makeFakeConvex();
    const tmux = makeFakeTmux();
    await expect(deliverMessage(convex.client as any, tmux.sink as any, {
      tickNumber: 7,
      receiveTickNumber: 7,
      receiveTimeoutMs: 1000,
      receivePollMs: 50,
      maxAttempts: 3,
      pendingMessages: [],
      signal: ac.signal,
    })).rejects.toThrow();
    // recordTickSend runs UNCONDITIONALLY before the throwIfAborted check —
    // mirrors current code. The protection kicks in at the attempt loop.
    expect(convex.calls).toContain("recordTickSend");
    expect(tmux.pasteCount).toBe(0);
  });

  it("does NOT consume pending messages when delivery never confirms (M-7 read-consume gap guard)", async () => {
    // Opus 4.7 M-7 flag: pendingMessages should not be marked consumed
    // unless we actually delivered them AND saw the hook receipt.
    // Without this guarantee, a paste failure + restart would silently drop
    // user-messages.
    const convex = makeFakeConvex({ hasTickReceive: async () => false });
    const tmux = makeFakeTmux();
    const result = await deliverMessage(convex.client as any, tmux.sink as any, {
      tickNumber: 7,
      receiveTickNumber: 7,
      receiveTimeoutMs: 5,
      receivePollMs: 1,
      maxAttempts: 2,
      pendingMessages: [pending("p1", "user-message")],
      signal: undefined,
    });
    expect(result.confirmed).toBe(false);
    expect(convex.consumedIds).toEqual([]);
    // hook_failure event must fire so the issue is visible upstream.
    expect(convex.recordedEvents).toContain("hook_failure");
  });

  it("consumes pending messages exactly once when delivery confirms on retry", async () => {
    // Second attempt succeeds → consume must run exactly once with the
    // correct pending IDs.
    let receiveCount = 0;
    const convex = makeFakeConvex({
      hasTickReceive: async () => { receiveCount++; return receiveCount > 1; },
    });
    const tmux = makeFakeTmux();
    const result = await deliverMessage(convex.client as any, tmux.sink as any, {
      tickNumber: 11,
      receiveTickNumber: 11,
      receiveTimeoutMs: 5,
      receivePollMs: 1,
      maxAttempts: 3,
      pendingMessages: [pending("p1", "user-message"), pending("p2", "admin-injection")],
      signal: undefined,
    });
    expect(result.confirmed).toBe(true);
    expect(convex.consumedIds).toEqual([["p1", "p2"]]);
  });

  it("returns unconfirmed without consuming when pre-paste readiness fails", async () => {
    // prePasteReady false → we ALSO must not consume. This is the timing
    // race where the pane briefly looked unready and the runner gave up.
    vi.useFakeTimers();
    try {
      const convex = makeFakeConvex();
      const tmux = makeFakeTmux({ paneText: "no prompt here at all" });
      const promise = deliverMessage(convex.client as any, tmux.sink as any, {
        tickNumber: 12,
        receiveTickNumber: 12,
        receiveTimeoutMs: 5,
        receivePollMs: 1,
        maxAttempts: 1,
        pendingMessages: [pending("p1", "user-message")],
        signal: undefined,
      });
      // Burn through prePasteReady's 10s timeout.
      await vi.advanceTimersByTimeAsync(11_000);
      const result = await promise;
      expect(result.confirmed).toBe(false);
      expect(convex.consumedIds).toEqual([]);
      expect(convex.recordedEvents).toContain("ready_probe_timeout");
    } finally {
      vi.useRealTimers();
    }
  });

  it("deliverPendingOnly returns null instantly when there are no pending messages (no tmux interaction)", async () => {
    // Zero-cost early return is load-bearing — handlePendingMessages calls
    // this on EVERY duplicate-tick wakeup. If we ever started touching tmux
    // for empty pending lists we'd silently double-paste.
    const convex = makeFakeConvex();
    const tmux = makeFakeTmux();
    const result = await deliverPendingOnly(convex.client as any, tmux.sink as any, {
      pendingMessages: [],
      receiveTimeoutMs: 5,
      receivePollMs: 1,
      maxAttempts: 1,
    });
    expect(result).toBeNull();
    expect(tmux.pasteCount).toBe(0);
    expect(convex.calls).not.toContain("recordTickSend");
  });
});

// -----------------------------------------------------------------------------
// 3. sleep — abort-listener cleanup
// -----------------------------------------------------------------------------

describe("sleep() abort handling", () => {
  it("rejects synchronously when signal is already aborted", async () => {
    const ac = new AbortController();
    ac.abort();
    await expect(sleep(1000, ac.signal)).rejects.toThrow(/aborted/);
  });

  it("removes the abort listener after natural completion (no leak)", async () => {
    vi.useFakeTimers();
    const ac = new AbortController();
    const removed = vi.fn();
    const origAdd = ac.signal.addEventListener.bind(ac.signal);
    const origRemove = ac.signal.removeEventListener.bind(ac.signal);
    (ac.signal as any).addEventListener = origAdd;
    (ac.signal as any).removeEventListener = (type: string, listener: any) => {
      if (type === "abort") removed();
      return origRemove(type, listener);
    };

    const promise = sleep(100, ac.signal);
    await vi.advanceTimersByTimeAsync(100);
    await promise;
    expect(removed).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("removes the abort listener after early abort (no leak)", async () => {
    vi.useFakeTimers();
    const ac = new AbortController();
    const removed = vi.fn();
    const origRemove = ac.signal.removeEventListener.bind(ac.signal);
    (ac.signal as any).removeEventListener = (type: string, listener: any) => {
      if (type === "abort") removed();
      return origRemove(type, listener);
    };

    const promise = sleep(10_000, ac.signal);
    ac.abort();
    await expect(promise).rejects.toThrow(/aborted/);
    expect(removed).toHaveBeenCalled();
    vi.useRealTimers();
  });
});

// -----------------------------------------------------------------------------
// 4. withBackoff — abort behavior
// -----------------------------------------------------------------------------

describe("withBackoff abort", () => {
  it("rejects when signal aborts during the backoff sleep", async () => {
    vi.useFakeTimers();
    const ac = new AbortController();
    const run = vi.fn(async () => { throw new Error("down"); });
    const promise = withBackoff(run, { label: "test", initialDelayMs: 1000, signal: ac.signal });
    // Let the first attempt fail and start sleeping.
    await vi.advanceTimersByTimeAsync(0);
    ac.abort();
    await expect(promise).rejects.toThrow(/aborted/);
    // The first attempt ran; the sleep was aborted before retry.
    expect(run).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("rejects on entry when signal is already aborted (no run call)", async () => {
    const ac = new AbortController();
    ac.abort();
    const run = vi.fn(async () => "ok");
    await expect(withBackoff(run, { label: "test", signal: ac.signal })).rejects.toThrow();
    expect(run).not.toHaveBeenCalled();
  });
});

// -----------------------------------------------------------------------------
// 5. flockGuard — contention & double-release
// -----------------------------------------------------------------------------

describe("flockGuard contention", () => {
  let dir: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "flock-race-")); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it("second acquire on the same lock path throws while the first is held", () => {
    const lockPath = path.join(dir, "elder.lock");
    const first = acquireFlock(lockPath);
    try {
      expect(() => acquireFlock(lockPath)).toThrow(/could not acquire flock/);
    } finally {
      first.release();
    }
    // After release, re-acquire MUST succeed — no leftover advisory lock.
    const second = acquireFlock(lockPath);
    second.release();
  });

  it("release() is idempotent (double release does not crash or close other fds)", () => {
    const lockPath = path.join(dir, "elder.lock");
    const handle = acquireFlock(lockPath);
    expect(() => { handle.release(); handle.release(); }).not.toThrow();
    // Even after double-release, re-acquire still works (no fd state was
    // corrupted by closing fd 0/1/2 etc).
    const next = acquireFlock(lockPath);
    next.release();
  });
});

// -----------------------------------------------------------------------------
// 6. postPasteSubmitted — gap documentation (no signal support)
// -----------------------------------------------------------------------------
//
// FINDING: postPasteSubmitted (and prePasteReady) do not accept an
// AbortSignal — they will run to completion even after SIGTERM, blocking
// graceful shutdown for up to READY_PROBE_TIMEOUT_MS + (STUCK_INPUT_MAX_RETRIES
// * STUCK_INPUT_RETRY_DELAY_MS) ≈ 11.5s. This test pins current behavior so
// any future fix that propagates a signal will deliberately update it.

describe("postPasteSubmitted abort gap (current behavior)", () => {
  it("continues retrying after external abort because no signal is plumbed (current behavior)", async () => {
    vi.useFakeTimers();
    const sendKeys = vi.fn(async () => {});
    const capturePane = vi.fn(async () => "│ > tick: 12"); // never empties
    const tmux = { sendKeys, capturePane } as any;

    // Caller "aborts" externally — but the function has no way to honor it.
    const ac = new AbortController();
    ac.abort();
    const promise = postPasteSubmitted(tmux);
    await vi.advanceTimersByTimeAsync(
      POST_PASTE_INITIAL_SETTLE_MS + STUCK_INPUT_RETRY_DELAY_MS * STUCK_INPUT_MAX_RETRIES,
    );
    await expect(promise).resolves.toBe(false);
    // Confirms the abort had zero effect — it ran the full retry budget.
    expect(sendKeys).toHaveBeenCalledTimes(STUCK_INPUT_MAX_RETRIES);
    vi.useRealTimers();
  });
});

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

// Yields to the microtask queue ~5 times so any chained .then() handlers
// inside an async generator have a chance to run synchronously.
async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

function aux(tick: number): RunnerAuxiliary {
  return {
    tickClock: {
      tick,
      tickEpochStartedAt: 0,
      tickEpochDurationMs: 60_000,
      seasonStartTick: 0,
      seasonEndTick: 360,
      winterActive: false,
    },
    gameSettings: {
      heartbeatIntervalSeconds: 60,
      memoryWipeTickInterval: 50,
      winterStartTick: 110,
      winterDurationTicks: 10,
      winterPeriodTicks: 110,
      seasonDurationTicks: 360,
      contractAddress: "0x0",
    },
    banditView: null,
    chainEvents: [],
    pendingMessages: [],
  };
}

function pending(id: string, source: PendingMessage["source"]): PendingMessage {
  return {
    _id: id,
    targetElderId: "elder-1",
    text: `text-${id}`,
    source,
    insertedAt: 0,
  };
}

interface FakeConvexOpts {
  hasTickReceive?: () => Promise<boolean>;
  hasMessageUidReceive?: () => Promise<boolean>;
}

function makeFakeConvex(opts: FakeConvexOpts = {}) {
  const calls: string[] = [];
  const consumedIds: string[][] = [];
  const recordedEvents: string[] = [];
  const client = {
    async recordTickSend(_tick: number, _hash: string, _meta?: unknown, _sig?: AbortSignal) {
      calls.push("recordTickSend");
      return { sendLogId: "tickSendLog:1" };
    },
    async isThematicUidTaken() { calls.push("isThematicUidTaken"); return false; },
    async hasTickReceive() {
      calls.push("hasTickReceive");
      return opts.hasTickReceive ? await opts.hasTickReceive() : true;
    },
    async hasMessageUidReceive() {
      calls.push("hasMessageUidReceive");
      return opts.hasMessageUidReceive ? await opts.hasMessageUidReceive() : true;
    },
    async consumePendingMessages(ids: string[]) {
      calls.push("consumePendingMessages");
      consumedIds.push([...ids]);
    },
    async recordRunnerEvent(kind: string) {
      calls.push(`event:${kind}`);
      recordedEvents.push(kind);
    },
  };
  return { client, calls, consumedIds, recordedEvents };
}

function makeFakeTmux(opts: { paneText?: string } = {}) {
  let pasteCount = 0;
  const sink = {
    async capturePane() { return opts.paneText ?? "│ > "; },
    async pasteMessage(_text: string) { pasteCount++; },
    async sendKeys(_key: string) {},
  };
  return {
    sink,
    get pasteCount() { return pasteCount; },
  };
}
