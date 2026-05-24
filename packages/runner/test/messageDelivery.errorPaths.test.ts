import { afterEach, describe, expect, it, vi } from "vitest";
import { deliverMessage, deliverPendingOnly } from "../src/messageDelivery.js";
import { READY_PROBE_TIMEOUT_MS } from "../src/pasteVerification.js";
import type { PendingMessage } from "../src/types.js";

/**
 * Error-path tests for messageDelivery.ts (Agent A — test-exp-A).
 *
 * Existing tests cover the happy path via tickHandler/resetFlow integration.
 * These exercise the FAILURE branches inside deliverMessage / deliverPendingOnly
 * directly:
 *   - retry-exhaustion after maxAttempts hits hook_failure event recording
 *   - pre-paste readiness failure short-circuits + records ready_probe_timeout
 *   - post-paste stuck-input failure short-circuits + records invariant_violation
 *   - signal.aborted at the top of the loop throws (abort propagation)
 *   - deliverPendingOnly early-returns null when pendingMessages is empty
 *   - deliverPendingOnly without a receive UID exhausts without confirmation
 */

interface ConvexCalls {
  events: Array<{ kind: string; msg: string }>;
  sends: number;
  consumed: number;
  hasReceive: () => boolean;
}

function makeConvex(opts: { hasReceive?: () => boolean } = {}): {
  convex: any;
  calls: ConvexCalls;
} {
  const calls: ConvexCalls = {
    events: [],
    sends: 0,
    consumed: 0,
    hasReceive: opts.hasReceive ?? (() => false),
  };
  const convex = {
    async recordTickSend() {
      calls.sends++;
      return { sendLogId: "tickSendLog:1" };
    },
    async hasTickReceive() {
      return calls.hasReceive();
    },
    async hasMessageUidReceive() {
      return calls.hasReceive();
    },
    async consumePendingMessages() {
      calls.consumed++;
    },
    async isThematicUidTaken() {
      return false;
    },
    async recordRunnerEvent(kind: string, msg: string) {
      calls.events.push({ kind, msg });
    },
  };
  return { convex, calls };
}

function makeTmux(opts: { prePasteReady?: boolean; postPasteSubmitted?: boolean } = {}): any {
  const prePasteReady = opts.prePasteReady ?? true;
  const postPasteSubmitted = opts.postPasteSubmitted ?? true;
  const pasted: string[] = [];
  let captureCallCount = 0;
  return {
    pasted,
    async pasteMessage(text: string) {
      pasted.push(text);
    },
    async sendKeys() {},
    async capturePane() {
      captureCallCount++;
      // Pre-paste-ready check: `> ` empty prompt
      // Post-paste-submitted check: empty prompt too
      // We can satisfy both by returning a pane with a `> ` prompt (truthy),
      // OR return text WITHOUT a prompt to fail pre-paste, OR return text
      // WITH a non-empty prompt to fail post-paste.
      if (!prePasteReady) return "(no prompt rendered yet)";
      if (!postPasteSubmitted) {
        // First capture is pre-paste (must look ready), subsequent are post-paste
        // (must look STUCK = non-empty prompt). Pre-paste passes; post-paste fails.
        if (captureCallCount === 1) return "│ > ";
        return "│ > tick: 99 stuck input";
      }
      return "│ > ";
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("deliverMessage error paths", () => {
  it("records hook_failure and returns unconfirmed after maxAttempts retry exhaustion", async () => {
    vi.useFakeTimers();
    const { convex, calls } = makeConvex({ hasReceive: () => false });
    const tmux = makeTmux();

    const promise = deliverMessage(convex, tmux, {
      tickNumber: 7,
      receiveTickNumber: 7,
      templates: [{ fileName: "x.md", content: "hi" }],
      receiveTimeoutMs: 1,
      receivePollMs: 1,
      maxAttempts: 3,
    });
    // 3 attempts × (200ms post-paste settle + 1ms receive timeout)
    await vi.advanceTimersByTimeAsync(5_000);

    const result = await promise;
    expect(result.confirmed).toBe(false);
    // hook_failure must mention the receive tick + the attempt count
    const failureEvent = calls.events.find((e) => e.kind === "hook_failure");
    expect(failureEvent?.msg).toContain("tick 7");
    expect(failureEvent?.msg).toContain("3 paste attempts");
    // Paste was attempted exactly maxAttempts times before giving up
    expect(tmux.pasted).toHaveLength(3);
    // No consume call — un-confirmed delivery must not mark messages consumed
    expect(calls.consumed).toBe(0);
  });

  it("records ready_probe_timeout and returns unconfirmed on pre-paste failure", async () => {
    vi.useFakeTimers();
    const { convex, calls } = makeConvex();
    const tmux = makeTmux({ prePasteReady: false });

    const promise = deliverMessage(convex, tmux, {
      tickNumber: 11,
      receiveTickNumber: 11,
      templates: [{ fileName: "x.md", content: "hi" }],
      receiveTimeoutMs: 1,
      receivePollMs: 1,
      maxAttempts: 3,
    });
    // prePasteReady has its own 10s internal deadline. Skip past it.
    await vi.advanceTimersByTimeAsync(READY_PROBE_TIMEOUT_MS + 100);

    const result = await promise;
    expect(result.confirmed).toBe(false);
    const event = calls.events.find((e) => e.kind === "ready_probe_timeout");
    expect(event).toBeDefined();
    expect(event?.msg).toContain("tick 11");
    // Critical: short-circuit — no paste attempts when pre-paste fails
    expect(tmux.pasted).toHaveLength(0);
  });

  it("records invariant_violation and returns unconfirmed on post-paste stuck input", async () => {
    vi.useFakeTimers();
    const { convex, calls } = makeConvex({ hasReceive: () => false });
    const tmux = makeTmux({ postPasteSubmitted: false });

    const promise = deliverMessage(convex, tmux, {
      tickNumber: 22,
      receiveTickNumber: 22,
      templates: [{ fileName: "x.md", content: "hi" }],
      receiveTimeoutMs: 1,
      receivePollMs: 1,
      maxAttempts: 3,
    });
    // postPasteSubmitted has 200ms initial settle + 3 retries × 500ms wait = ~1.7s
    await vi.advanceTimersByTimeAsync(5_000);

    const result = await promise;
    expect(result.confirmed).toBe(false);
    const event = calls.events.find((e) => e.kind === "invariant_violation");
    expect(event).toBeDefined();
    expect(event?.msg).toContain("tick 22");
    // Pasted once before postPasteSubmitted determined "stuck"
    expect(tmux.pasted).toHaveLength(1);
  });

  it("throws when signal is already aborted at the top of the delivery loop", async () => {
    const { convex } = makeConvex();
    const tmux = makeTmux();
    const ac = new AbortController();
    ac.abort();

    await expect(
      deliverMessage(convex, tmux, {
        tickNumber: 5,
        receiveTickNumber: 5,
        templates: [{ fileName: "x.md", content: "hi" }],
        receiveTimeoutMs: 1,
        receivePollMs: 1,
        maxAttempts: 3,
        signal: ac.signal,
      }),
    ).rejects.toThrow();

    // No paste was attempted — abort must short-circuit before tmux work
    expect(tmux.pasted).toHaveLength(0);
  });

});

describe("deliverPendingOnly error paths", () => {
  it("returns null immediately when pendingMessages is empty (no convex/tmux work)", async () => {
    const { convex, calls } = makeConvex();
    const tmux = makeTmux();

    const result = await deliverPendingOnly(convex, tmux, {
      pendingMessages: [],
      receiveTimeoutMs: 1,
      receivePollMs: 1,
      maxAttempts: 3,
    });

    expect(result).toBeNull();
    // Critical: no thematic-uid generation, no compose, no paste
    expect(tmux.pasted).toHaveLength(0);
    expect(calls.sends).toBe(0);
  });

  it("returns null when pendingMessages is undefined", async () => {
    const { convex } = makeConvex();
    const tmux = makeTmux();

    const result = await deliverPendingOnly(convex, tmux, {
      receiveTimeoutMs: 1,
      receivePollMs: 1,
      maxAttempts: 3,
    });

    expect(result).toBeNull();
  });

  it("records hook_failure and returns unconfirmed after exhausting maxAttempts on uid wait", async () => {
    vi.useFakeTimers();
    const { convex, calls } = makeConvex({ hasReceive: () => false });
    const tmux = makeTmux();
    const pending: PendingMessage[] = [
      {
        _id: "pendingMessages:9",
        targetElderId: "elder-1",
        text: "hello from admin",
        source: "admin-injection",
        insertedAt: 1,
      },
    ];

    const promise = deliverPendingOnly(convex, tmux, {
      pendingMessages: pending,
      receiveTimeoutMs: 1,
      receivePollMs: 1,
      maxAttempts: 2,
    });
    await vi.advanceTimersByTimeAsync(5_000);

    const result = await promise;
    expect(result?.confirmed).toBe(false);
    const event = calls.events.find((e) => e.kind === "hook_failure");
    expect(event?.msg).toContain("pending message");
    expect(event?.msg).toContain("2 paste attempts");
    // Critical: tried maxAttempts times before giving up
    expect(tmux.pasted).toHaveLength(2);
    // Composed text DOES carry a special-msg envelope — first envelope UID extracted
    expect(result?.text.startsWith("special-msg: ")).toBe(true);
  });

  it("records ready_probe_timeout on pre-paste failure (pending path)", async () => {
    vi.useFakeTimers();
    const { convex, calls } = makeConvex();
    const tmux = makeTmux({ prePasteReady: false });
    const pending: PendingMessage[] = [
      {
        _id: "pendingMessages:5",
        targetElderId: "elder-1",
        text: "x",
        source: "user-message",
        insertedAt: 1,
      },
    ];

    const promise = deliverPendingOnly(convex, tmux, {
      pendingMessages: pending,
      receiveTimeoutMs: 1,
      receivePollMs: 1,
      maxAttempts: 1,
    });
    await vi.advanceTimersByTimeAsync(READY_PROBE_TIMEOUT_MS + 100);

    const result = await promise;
    expect(result?.confirmed).toBe(false);
    const event = calls.events.find((e) => e.kind === "ready_probe_timeout");
    expect(event?.msg).toContain("pending message");
    expect(tmux.pasted).toHaveLength(0);
  });
});
