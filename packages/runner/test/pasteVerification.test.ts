import { afterEach, describe, expect, it, vi } from "vitest";
import type { TmuxSink } from "../src/tmuxSink.js";
import {
  postPasteSubmitted,
  prePasteReady,
  POST_PASTE_INITIAL_SETTLE_MS,
  READY_PROBE_INTERVAL_MS,
  READY_PROBE_TIMEOUT_MS,
  STUCK_INPUT_MAX_RETRIES,
  STUCK_INPUT_RETRY_DELAY_MS,
} from "../src/pasteVerification.js";

describe("paste verification", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("pre-paste returns true when the prompt is visible immediately", async () => {
    const tmux = mockTmux([
      pane("Claude is ready", "\u2502 > "),
    ]);

    await expect(prePasteReady(tmux)).resolves.toBe(true);
    expect(tmux.capturePane).toHaveBeenCalledTimes(1);
  });

  it("pre-paste detects modern Claude TUI prompt glyphs (>, ❯, ›)", async () => {
    // Newer Claude Code TUI builds render the prompt as "❯" (U+276F) instead
    // of ASCII ">"; some themes use "›" (U+203A). The readiness probe must
    // accept all three or it silently times out every tick (the 2026-05-26 runner
    // outage). An empty input region after the glyph = ready.
    for (const glyph of [">", "❯", "›"]) {
      const tmux = mockTmux([pane("Claude is ready", `│ ${glyph} `)]);
      await expect(prePasteReady(tmux)).resolves.toBe(true);
    }
  });

  it("pre-paste does NOT treat a non-empty ❯ input (busy) as ready", async () => {
    vi.useFakeTimers();
    const tmux = mockTmux([pane("Claude is thinking", "│ ❯ draft the orders")]);
    const promise = prePasteReady(tmux);
    await vi.advanceTimersByTimeAsync(READY_PROBE_TIMEOUT_MS);
    await expect(promise).resolves.toBe(false);
  });

  it("pre-paste waits until the prompt appears", async () => {
    vi.useFakeTimers();
    const tmux = mockTmux([
      pane("Starting Claude...", "Loading session"),
      pane("Still warming up"),
      pane("Claude is ready", "\u2502 > "),
    ]);

    const promise = prePasteReady(tmux);
    await vi.advanceTimersByTimeAsync(READY_PROBE_INTERVAL_MS);
    await vi.advanceTimersByTimeAsync(READY_PROBE_INTERVAL_MS);

    await expect(promise).resolves.toBe(true);
    expect(tmux.capturePane).toHaveBeenCalledTimes(3);
  });

  it("pre-paste returns false when the prompt never appears before timeout", async () => {
    vi.useFakeTimers();
    const tmux = mockTmux([
      pane("Starting Claude...", "Loading session"),
    ]);

    const promise = prePasteReady(tmux);
    await vi.advanceTimersByTimeAsync(READY_PROBE_TIMEOUT_MS);

    await expect(promise).resolves.toBe(false);
    expect(tmux.capturePane).toHaveBeenCalled();
  });

  it("post-paste returns true when the input is empty", async () => {
    const tmux = mockTmux([
      pane("Submitted", "\u2502 > "),
    ]);

    await expect(postPasteSubmitted(tmux)).resolves.toBe(true);
    expect(tmux.capturePane).toHaveBeenCalledTimes(1);
    expect(tmux.sendKeys).not.toHaveBeenCalled();
  });

  it("post-paste resends Enter and returns true when the input clears", async () => {
    vi.useFakeTimers();
    const tmux = mockTmux([
      pane("\u2502 > tick: 12"),
      pane("Thinking...", "\u2502 > "),
    ]);

    const promise = postPasteSubmitted(tmux);
    // Skip past the initial-settle sleep + one retry sleep.
    await vi.advanceTimersByTimeAsync(POST_PASTE_INITIAL_SETTLE_MS + STUCK_INPUT_RETRY_DELAY_MS);

    await expect(promise).resolves.toBe(true);
    expect(tmux.sendKeys).toHaveBeenCalledTimes(1);
    expect(tmux.sendKeys).toHaveBeenCalledWith("Enter");
    expect(tmux.capturePane).toHaveBeenCalledTimes(2);
  });

  it("post-paste returns false when the input remains stuck after all retries", async () => {
    vi.useFakeTimers();
    const tmux = mockTmux([
      pane("\u2502 > tick: 12"),
    ]);

    const promise = postPasteSubmitted(tmux);
    await vi.advanceTimersByTimeAsync(
      POST_PASTE_INITIAL_SETTLE_MS + STUCK_INPUT_RETRY_DELAY_MS * STUCK_INPUT_MAX_RETRIES,
    );

    await expect(promise).resolves.toBe(false);
    expect(tmux.sendKeys).toHaveBeenCalledTimes(STUCK_INPUT_MAX_RETRIES);
    expect(tmux.capturePane).toHaveBeenCalledTimes(STUCK_INPUT_MAX_RETRIES + 1);
  });

  it("post-paste returns false when no prompt is visible (gemini R1 MED \u2014 defends crashed pane)", async () => {
    vi.useFakeTimers();
    // No input-box-prompt line at all (TUI crashed / blank pane).
    const tmux = mockTmux([
      pane("(some garbled output)", "no recognizable prompt here"),
    ]);

    const promise = postPasteSubmitted(tmux);
    await vi.advanceTimersByTimeAsync(
      POST_PASTE_INITIAL_SETTLE_MS + STUCK_INPUT_RETRY_DELAY_MS * STUCK_INPUT_MAX_RETRIES,
    );

    await expect(promise).resolves.toBe(false);
  });
});

function mockTmux(captures: string[]): TmuxSink & {
  capturePane: ReturnType<typeof vi.fn>;
  sendKeys: ReturnType<typeof vi.fn>;
} {
  let index = 0;
  const capturePane = vi.fn(async () => {
    const paneText = captures[Math.min(index, captures.length - 1)] ?? "";
    index++;
    return paneText;
  });
  const sendKeys = vi.fn(async () => {});
  return { capturePane, sendKeys } as unknown as TmuxSink & {
    capturePane: ReturnType<typeof vi.fn>;
    sendKeys: ReturnType<typeof vi.fn>;
  };
}

function pane(...lines: string[]): string {
  return lines.join("\n");
}
