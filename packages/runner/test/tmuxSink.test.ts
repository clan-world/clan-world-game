import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Regression tests for PR #543 hot-fix: TmuxSink.loadBuffer.
 *
 * Background — the production bug:
 *   The original implementation used
 *     `execFile("tmux", ["load-buffer", "-b", name, "-"], { input: content } as any)`.
 *   The `input` option is documented on execFileSync but NOT on the async
 *   execFile — the async variant silently drops it. tmux exits 0 with an
 *   empty buffer, no error surfaces, and commands pasted afterward are empty.
 *   The `as any` cast hid the type signal. Failure mode: supervisor claims a
 *   command, pastes an empty buffer into Claude, healthcheck stays green
 *   because Claude is alive — just never receives anything. Production-
 *   breaking and silent.
 *
 * Fix: switch to `spawn` + `child.stdin.end(content, "utf8")` which actually
 * pipes content into tmux's stdin.
 *
 * These tests pin runtime behavior by mocking child_process and verifying:
 *   - spawn is invoked with the correct tmux argv shape
 *   - content is END'd to stdin (writes + closes) — this is the bug guard:
 *     a regression that switches back to execFile would not call stdin.end
 *   - execFile is NOT used for loadBuffer (its `input` option is sync-only)
 *   - non-zero exit codes are surfaced as rejection
 *   - spawn errors (e.g. ENOENT) propagate as rejection
 */

describe("TmuxSink.loadBuffer (mock-based regression for PR #543 hot-fix)", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("pipes content via spawn().stdin.end(content, 'utf8'), not via execFile input option", async () => {
    const stdinEnd = vi.fn();
    const stdinOn = vi.fn();
    const childOn = vi.fn();

    // Capture handlers so we can fire 'close' once stdin.end is called.
    const handlers: Record<string, (...args: unknown[]) => void> = {};
    const mockChild = {
      on: childOn,
      stdin: { on: stdinOn, end: stdinEnd },
    };
    childOn.mockImplementation((event: string, cb: (...args: unknown[]) => void) => {
      handlers[event] = cb;
      return mockChild;
    });

    const spawnSpy = vi.fn(() => mockChild);
    const execFileSpy = vi.fn();

    vi.doMock("node:child_process", () => ({
      execFile: execFileSpy,
      spawn: spawnSpy,
    }));

    const { TmuxSink } = await import("../src/tmuxSink.js");
    const sink = new TmuxSink("elder-test");

    queueMicrotask(() => handlers.close?.(0));
    await sink.loadBuffer("elder-input", "hello world payload");

    // Critical: spawn called with tmux argv reading from stdin (the `-`).
    expect(spawnSpy).toHaveBeenCalledTimes(1);
    expect(spawnSpy).toHaveBeenCalledWith("tmux", ["load-buffer", "-b", "elder-input", "-"]);

    // Critical: content must be END'd to stdin (writes + closes). Without
    // this, tmux gets EOF on an empty buffer — the PR #543 production bug.
    expect(stdinEnd).toHaveBeenCalledTimes(1);
    expect(stdinEnd).toHaveBeenCalledWith("hello world payload", "utf8");

    // The async execFile MUST NOT be used for loadBuffer (its `input`
    // option is sync-only and silently drops content). If a future
    // refactor switches back, this test fails loud.
    expect(execFileSpy).not.toHaveBeenCalled();
  });

  it("rejects when the spawned tmux exits non-zero", async () => {
    const handlers: Record<string, (...args: unknown[]) => void> = {};
    const mockChild = {
      on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
        handlers[event] = cb;
        return mockChild;
      }),
      stdin: {
        on: vi.fn(),
        end: vi.fn(),
      },
    };

    vi.doMock("node:child_process", () => ({
      execFile: vi.fn(),
      spawn: vi.fn(() => mockChild),
    }));

    const { TmuxSink } = await import("../src/tmuxSink.js");
    const sink = new TmuxSink("elder-test");

    queueMicrotask(() => handlers.close?.(1));

    await expect(sink.loadBuffer("elder-input", "payload")).rejects.toThrow(/exited with code 1/);
  });

  it("rejects when spawn emits an error event (e.g. tmux not installed)", async () => {
    const handlers: Record<string, (...args: unknown[]) => void> = {};
    const mockChild = {
      on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
        handlers[event] = cb;
        return mockChild;
      }),
      stdin: {
        on: vi.fn(),
        end: vi.fn(),
      },
    };

    vi.doMock("node:child_process", () => ({
      execFile: vi.fn(),
      spawn: vi.fn(() => mockChild),
    }));

    const { TmuxSink } = await import("../src/tmuxSink.js");
    const sink = new TmuxSink("elder-test");

    const bootError = new Error("ENOENT: tmux not found");
    queueMicrotask(() => handlers.error?.(bootError));

    await expect(sink.loadBuffer("elder-input", "payload")).rejects.toThrow(/ENOENT: tmux not found/);
  });

  it("rejects when child.stdin emits an error", async () => {
    const handlers: Record<string, (...args: unknown[]) => void> = {};
    const stdinHandlers: Record<string, (...args: unknown[]) => void> = {};
    const mockChild = {
      on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
        handlers[event] = cb;
        return mockChild;
      }),
      stdin: {
        on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
          stdinHandlers[event] = cb;
        }),
        end: vi.fn(),
      },
    };

    vi.doMock("node:child_process", () => ({
      execFile: vi.fn(),
      spawn: vi.fn(() => mockChild),
    }));

    const { TmuxSink } = await import("../src/tmuxSink.js");
    const sink = new TmuxSink("elder-test");

    queueMicrotask(() => stdinHandlers.error?.(new Error("EPIPE: write to closed stdin")));

    await expect(sink.loadBuffer("elder-input", "payload")).rejects.toThrow(/EPIPE/);
  });
});

describe("clanColorToTmuxStyle", () => {
  it("maps known clan colors to tmux bg/fg and falls back to green for unknown", async () => {
    const { clanColorToTmuxStyle } = await import("../src/tmuxSink.js");
    expect(clanColorToTmuxStyle("blue")).toEqual({ bg: "blue", fg: "white" });
    expect(clanColorToTmuxStyle("cyan")).toEqual({ bg: "cyan", fg: "black" });
    expect(clanColorToTmuxStyle("red")).toEqual({ bg: "red", fg: "white" });
    expect(clanColorToTmuxStyle("green")).toEqual({ bg: "green", fg: "black" });
    expect(clanColorToTmuxStyle("purple")).toEqual({ bg: "colour93", fg: "white" });
    expect(clanColorToTmuxStyle("olive")).toEqual({ bg: "green", fg: "black" }); // unknown → default
  });
});
