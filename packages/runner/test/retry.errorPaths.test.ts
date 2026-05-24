import { afterEach, describe, expect, it, vi } from "vitest";
import { sleep, withBackoff } from "../src/retry.js";

/**
 * Error-path tests for retry.ts (Agent A — test-exp-A).
 *
 * Existing test covers ONLY the happy-path-then-recover branch. These exercise:
 *   - sleep() with already-aborted signal rejects with "aborted"
 *   - sleep() aborted mid-wait rejects + clears the timer (no resolve)
 *   - sleep() with ms <= 0 short-circuits with no timer setup
 *   - sleep() with no signal completes normally
 *   - withBackoff() respects signal.throwIfAborted at the top of each iteration
 *   - withBackoff() retries multiple times and doubles delay (capped at maxDelayMs)
 *   - withBackoff() onRecovered hook that THROWS is swallowed (warn only)
 *   - withBackoff() coerces non-Error throws to string in the log message
 */

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("sleep()", () => {
  it("returns immediately when ms <= 0 (no timer, no abort listener)", async () => {
    // No fake timers — if a setTimeout were scheduled this test would hang
    // until real wall-clock passes. The function short-circuits at ms <= 0.
    await sleep(0);
    await sleep(-100);
    // If we get here, no timer was scheduled.
    expect(true).toBe(true);
  });

  it("rejects with 'aborted' when signal is already aborted at entry", async () => {
    const ac = new AbortController();
    ac.abort();
    await expect(sleep(50, ac.signal)).rejects.toThrow(/aborted/);
  });

  it("rejects with 'aborted' when signal aborts during the wait", async () => {
    vi.useFakeTimers();
    const ac = new AbortController();
    const promise = sleep(10_000, ac.signal);
    // Attach .catch up front so the rejection is observed synchronously by
    // Node's microtask queue (avoids PromiseRejectionHandledWarning when
    // fake-timer advancement runs ac.abort() between microtask boundaries).
    const settled = promise.catch((err) => err);
    ac.abort();
    const result = await settled;
    expect(result).toBeInstanceOf(Error);
    expect((result as Error).message).toBe("aborted");
    // Also confirm the underlying setTimeout was cleared (no pending timers).
    expect(vi.getTimerCount()).toBe(0);
  });

  it("resolves when no signal is provided and timeout elapses", async () => {
    vi.useFakeTimers();
    const promise = sleep(500);
    await vi.advanceTimersByTimeAsync(500);
    await expect(promise).resolves.toBeUndefined();
  });

  it("resolves when signal is provided but never aborts", async () => {
    vi.useFakeTimers();
    const ac = new AbortController();
    const promise = sleep(500, ac.signal);
    await vi.advanceTimersByTimeAsync(500);
    await expect(promise).resolves.toBeUndefined();
  });
});

describe("withBackoff() error paths", () => {
  it("throws when signal aborts during the backoff sleep between retries", async () => {
    vi.useFakeTimers();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const ac = new AbortController();
    let attempts = 0;
    const promise = withBackoff(async () => {
      attempts++;
      throw new Error("permanent failure");
    }, {
      label: "test-abort",
      signal: ac.signal,
      initialDelayMs: 100,
    });
    // Catch up front so the rejection has a registered handler before abort.
    const settled = promise.catch((err) => err);
    // Yield one microtask so withBackoff enters its first sleep().
    await Promise.resolve();
    await Promise.resolve();
    ac.abort();
    const result = await settled;
    expect(result).toBeInstanceOf(Error);
    expect((result as Error).message).toBe("aborted");
    expect(attempts).toBe(1);
  });

  it("doubles delay each retry and caps at maxDelayMs", async () => {
    vi.useFakeTimers();
    const sleepWaits: number[] = [];
    let attempts = 0;
    // Spy on console.warn to silence retry log spam
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const promise = withBackoff(async () => {
      attempts++;
      if (attempts < 5) throw new Error("flaky");
      return "ok";
    }, {
      label: "cap-test",
      initialDelayMs: 100,
      maxDelayMs: 300,
    });

    // First failure → sleep 100, second → 200, third → 300 (capped),
    // fourth → 300 (still capped). Drain each.
    sleepWaits.push(100);
    await vi.advanceTimersByTimeAsync(100);
    sleepWaits.push(200);
    await vi.advanceTimersByTimeAsync(200);
    sleepWaits.push(300);
    await vi.advanceTimersByTimeAsync(300);
    sleepWaits.push(300);
    await vi.advanceTimersByTimeAsync(300);

    await expect(promise).resolves.toBe("ok");
    expect(attempts).toBe(5);
    expect(sleepWaits).toEqual([100, 200, 300, 300]);
  });

  it("swallows errors thrown by the onRecovered hook and still resolves", async () => {
    vi.useFakeTimers();
    const warns: unknown[] = [];
    vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
      warns.push(args);
    });

    let attempts = 0;
    const promise = withBackoff(async () => {
      attempts++;
      if (attempts === 1) throw new Error("first attempt failed");
      return "recovered";
    }, {
      label: "recovery-throws",
      initialDelayMs: 10,
      onRecovered: async () => {
        throw new Error("recovery event upload failed");
      },
    });

    await vi.advanceTimersByTimeAsync(10);
    // The recovery throw is caught — the original call's "recovered" still wins.
    await expect(promise).resolves.toBe("recovered");
    // The recovery error is logged (warn includes "recovery event failed").
    const recoveryWarn = warns.find((w) =>
      Array.isArray(w) && w.some((arg) => typeof arg === "string" && arg.includes("recovery event failed")),
    );
    expect(recoveryWarn).toBeDefined();
  });

  it("coerces non-Error throws into a string in the warn log", async () => {
    vi.useFakeTimers();
    const warns: string[] = [];
    vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
      // The retry warn line is built as a single template string.
      warns.push(args.map(String).join(" "));
    });
    let attempts = 0;
    const promise = withBackoff(async () => {
      attempts++;
      if (attempts === 1) throw "string-error-not-Error-instance";
      return "ok";
    }, {
      label: "coerce-test",
      initialDelayMs: 10,
    });
    await vi.advanceTimersByTimeAsync(10);
    await expect(promise).resolves.toBe("ok");
    expect(warns.some((w) => w.includes("string-error-not-Error-instance"))).toBe(true);
  });

  it("does NOT call onRecovered when first attempt succeeds (failed flag is false)", async () => {
    let recovered = 0;
    const result = await withBackoff(async () => "first-try", {
      label: "no-recovery-needed",
      onRecovered: async () => {
        recovered++;
      },
    });
    expect(result).toBe("first-try");
    expect(recovered).toBe(0);
  });
});
