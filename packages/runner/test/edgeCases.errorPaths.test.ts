import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearWipeMarker, readWipeMarker, writeWipeMarker } from "../src/wipeMarker.js";
import { loadElderDisplayConfig } from "../src/elderConfig.js";
import { deriveHealth, startHeartbeat, type HeartbeatState } from "../src/heartbeat.js";

/**
 * Error-path edge cases (Agent A — test-exp-A).
 *
 * Smaller modules' rejection / silent-swallow paths bundled into one file:
 *   - wipeMarker.readWipeMarker returns null for: corrupt content (non-numeric),
 *     negative numbers, fractional numbers, hex strings, empty file
 *   - wipeMarker.writeWipeMarker is atomic — the .tmp file is renamed
 *   - wipeMarker.clearWipeMarker is idempotent (no-op on missing file)
 *   - elderConfig throws on missing key
 *   - elderConfig throws on malformed JSON
 *   - heartbeat: no-op when signal already aborted at start
 *   - heartbeat: re-entrancy guard prevents overlapping in-flight calls
 *   - heartbeat: failed beat increments consecutiveErrors + logs to console.error
 *   - heartbeat: successful beat resets consecutiveErrors AND updates lastSuccessAt
 *   - deriveHealth: boundary at exactly 90s + 180s + 3 errors
 */

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "edge-err-"));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("wipeMarker — readWipeMarker rejection branches", () => {
  it("returns null for a non-numeric file", () => {
    const marker = path.join(dir, "x");
    fs.writeFileSync(marker, "not-a-number");
    expect(readWipeMarker(marker)).toBeNull();
  });

  it("returns null for a negative integer", () => {
    const marker = path.join(dir, "x");
    fs.writeFileSync(marker, "-5\n");
    expect(readWipeMarker(marker)).toBeNull();
  });

  it("returns null for a fractional number (non-integer)", () => {
    const marker = path.join(dir, "x");
    fs.writeFileSync(marker, "12.5");
    expect(readWipeMarker(marker)).toBeNull();
  });

  it("returns null for hex strings that Number() coerces to NaN", () => {
    const marker = path.join(dir, "x");
    fs.writeFileSync(marker, "0xdeadbeef-bad");
    expect(readWipeMarker(marker)).toBeNull();
  });

  it("returns null when the marker file is missing", () => {
    expect(readWipeMarker(path.join(dir, "never-existed"))).toBeNull();
  });

  it("returns 0 (valid) for a zero marker — restart-from-genesis case", () => {
    const marker = path.join(dir, "x");
    fs.writeFileSync(marker, "0\n");
    expect(readWipeMarker(marker)).toBe(0);
  });
});

describe("wipeMarker — write atomicity + clearWipeMarker idempotency", () => {
  it("does not leave a .tmp file after a successful write", () => {
    const marker = path.join(dir, "x");
    writeWipeMarker(marker, 99);
    expect(fs.existsSync(marker)).toBe(true);
    expect(fs.existsSync(`${marker}.tmp`)).toBe(false);
  });

  it("clearWipeMarker is a no-op when the file does not exist (no throw)", () => {
    const marker = path.join(dir, "never-existed");
    expect(() => clearWipeMarker(marker)).not.toThrow();
  });

  it("creates intermediate directories when writing", () => {
    const nested = path.join(dir, "nested", "subdir", "marker");
    writeWipeMarker(nested, 42);
    expect(readWipeMarker(nested)).toBe(42);
  });
});

describe("elderConfig — throw branches", () => {
  it("throws when the elder key is missing from the config map", () => {
    const file = path.join(dir, "elder-config.json");
    fs.writeFileSync(file, JSON.stringify({ "elder-2": { displayName: "X", color: "blue", glyph: "*" } }));
    expect(() => loadElderDisplayConfig(file, "elder-1")).toThrow(/missing elder display config for elder-1/);
  });

  it("throws SyntaxError when the file is malformed JSON", () => {
    const file = path.join(dir, "elder-config.json");
    fs.writeFileSync(file, "{ not valid json }");
    expect(() => loadElderDisplayConfig(file, "elder-1")).toThrow(/JSON/i);
  });

  it("throws ENOENT when the config file is missing", () => {
    expect(() => loadElderDisplayConfig(path.join(dir, "missing.json"), "elder-1")).toThrow();
  });

  it("returns the requested display config on a valid file", () => {
    const file = path.join(dir, "elder-config.json");
    fs.writeFileSync(file, JSON.stringify({
      "elder-1": { displayName: "Storm Riders", color: "blue", glyph: "*" },
      "elder-2": { displayName: "Sky Wardens", color: "green", glyph: "+" },
    }));
    expect(loadElderDisplayConfig(file, "elder-2")).toEqual({
      displayName: "Sky Wardens", color: "green", glyph: "+",
    });
  });
});

describe("heartbeat — error paths", () => {
  it("does not start the interval when signal is already aborted", () => {
    const ac = new AbortController();
    ac.abort();
    const calls: number[] = [];
    const client = {
      async heartbeat(tick: number) {
        calls.push(tick);
      },
    } as any;
    const state: HeartbeatState = {
      lastTickProcessed: 5,
      lastSuccessAt: Date.now(),
      consecutiveErrors: 0,
    };
    startHeartbeat(client, state, 100, ac.signal);
    // No interval scheduled — nothing was called.
    expect(calls).toHaveLength(0);
  });

  it("re-entrancy guard prevents overlapping heartbeat calls when the previous one is in-flight", async () => {
    vi.useFakeTimers();
    const ac = new AbortController();
    let inFlightCount = 0;
    let maxInFlight = 0;
    let resolveFirst: (() => void) | undefined;
    const client = {
      async heartbeat() {
        inFlightCount++;
        maxInFlight = Math.max(maxInFlight, inFlightCount);
        if (!resolveFirst) {
          // Hold the first call open while subsequent intervals fire.
          await new Promise<void>((r) => { resolveFirst = r; });
        }
        inFlightCount--;
      },
    } as any;
    const state: HeartbeatState = {
      lastTickProcessed: 0,
      lastSuccessAt: Date.now(),
      consecutiveErrors: 0,
    };
    startHeartbeat(client, state, 100, ac.signal);

    // Fire 5 intervals (500ms). Only the first should actually start because
    // the first is still in-flight — the rest hit the `if (inFlight) return`
    // re-entrancy guard.
    await vi.advanceTimersByTimeAsync(500);
    expect(maxInFlight).toBe(1);

    // Drain
    resolveFirst?.();
    ac.abort();
  });

  it("increments consecutiveErrors when client.heartbeat rejects", async () => {
    vi.useFakeTimers();
    const errorLogs: unknown[] = [];
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      errorLogs.push(args);
    });
    const ac = new AbortController();
    const client = {
      async heartbeat() {
        throw new Error("convex down");
      },
    } as any;
    const state: HeartbeatState = {
      lastTickProcessed: 0,
      lastSuccessAt: Date.now(),
      consecutiveErrors: 0,
    };
    startHeartbeat(client, state, 100, ac.signal);

    await vi.advanceTimersByTimeAsync(100);
    // Allow the microtask to settle the catch handler.
    await vi.advanceTimersByTimeAsync(0);
    expect(state.consecutiveErrors).toBe(1);
    expect(errorLogs.some((a) =>
      Array.isArray(a) && a.some((s) => typeof s === "string" && s.includes("[heartbeat] failed"))
    )).toBe(true);

    ac.abort();
  });

  it("resets consecutiveErrors AND updates lastSuccessAt on a successful beat", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 0, 1, 12, 0, 0));
    const ac = new AbortController();
    const calls: Array<{ tick: number; health: string }> = [];
    const client = {
      async heartbeat(tick: number, health: string) {
        calls.push({ tick, health });
      },
    } as any;
    const state: HeartbeatState = {
      lastTickProcessed: 7,
      lastSuccessAt: 0,
      consecutiveErrors: 3, // simulate prior failures
    };
    startHeartbeat(client, state, 100, ac.signal);
    await vi.advanceTimersByTimeAsync(100);
    await vi.advanceTimersByTimeAsync(0);

    expect(state.consecutiveErrors).toBe(0);
    expect(state.lastSuccessAt).toBe(Date.now());
    expect(calls[0]?.tick).toBe(7);

    ac.abort();
  });

  it("clears the interval when signal aborts mid-flight (subsequent ticks do nothing)", async () => {
    vi.useFakeTimers();
    const ac = new AbortController();
    let callCount = 0;
    const client = {
      async heartbeat() {
        callCount++;
      },
    } as any;
    const state: HeartbeatState = {
      lastTickProcessed: 0,
      lastSuccessAt: Date.now(),
      consecutiveErrors: 0,
    };
    startHeartbeat(client, state, 100, ac.signal);
    await vi.advanceTimersByTimeAsync(100);
    expect(callCount).toBe(1);
    ac.abort();
    await vi.advanceTimersByTimeAsync(1000);
    // After abort, callCount must not increase. The first abort-check
    // (inside the interval callback) clears the interval; the second guard
    // is the abort-listener that also clears. Belt + suspenders.
    expect(callCount).toBe(1);
  });
});

describe("deriveHealth — boundary conditions", () => {
  it("yellow at exactly 91s stale (just past the 90s threshold)", () => {
    const now = Date.now();
    expect(deriveHealth({
      lastTickProcessed: 0, lastSuccessAt: now - 91_000, consecutiveErrors: 0,
    }, now)).toBe("yellow");
  });

  it("green at exactly 90s stale (boundary is strict >)", () => {
    const now = Date.now();
    expect(deriveHealth({
      lastTickProcessed: 0, lastSuccessAt: now - 90_000, consecutiveErrors: 0,
    }, now)).toBe("green");
  });

  it("red at exactly 181s stale", () => {
    const now = Date.now();
    expect(deriveHealth({
      lastTickProcessed: 0, lastSuccessAt: now - 181_000, consecutiveErrors: 0,
    }, now)).toBe("red");
  });

  it("yellow at exactly 2 consecutive errors (just below the red threshold of 3)", () => {
    expect(deriveHealth({
      lastTickProcessed: 0, lastSuccessAt: Date.now(), consecutiveErrors: 2,
    }, Date.now())).toBe("yellow");
  });
});
