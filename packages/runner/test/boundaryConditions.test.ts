// Boundary-condition tests for packages/runner.
//
// Agent B in the 2026-05-24 parallel test-improvement experiment. Focus:
// off-by-one, threshold edges, zero/null/empty/MAX_SAFE_INTEGER, integer
// overflow, NaN/Infinity sneaking through guards, empty-string coercion.
// Companion gemini found a `>` vs `>=` bug on wipeMarkerTick during Bundle
// 4 — this file probes the surrounding decision surface for siblings.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  containsMemoryWipeTick,
  decideRestart,
  isScheduledMemoryWipeTick,
} from "../src/restartDecision.js";
import { deriveHealth, type HeartbeatState } from "../src/heartbeat.js";
import { composeMessage } from "../src/messageComposer.js";
import {
  describeSettingsDrift,
  settingsEqual,
} from "../src/settingsCache.js";
import {
  clearWipeMarker,
  readWipeMarker,
  writeWipeMarker,
} from "../src/wipeMarker.js";
import type { GameSettings } from "../src/types.js";

const baseDecision = {
  currentTick: 10,
  lastReceivedTick: 9,
  sentForCurrentTick: false,
  memoryWipeTickInterval: 50,
  wipeMarkerTick: null as number | null,
};

const baseSettings: GameSettings = {
  heartbeatIntervalSeconds: 60,
  memoryWipeTickInterval: 50,
  winterStartTick: 110,
  winterDurationTicks: 10,
  winterPeriodTicks: 110,
  seasonDurationTicks: 360,
  contractAddress: "0xabc",
};

// ─────────────────────────────────────────────────────────────────────────────
// restartDecision boundary surface
// ─────────────────────────────────────────────────────────────────────────────

describe("decideRestart — wipeMarkerTick boundary symmetry", () => {
  // Existing tests cover wipeMarkerTick == lastReceivedTick (wait) and
  // wipeMarkerTick > lastReceivedTick (reset). The off-by-one in the other
  // direction — wipeMarkerTick *strictly below* — must NOT trigger reset.
  it("does not reset when wipeMarkerTick is one BELOW lastReceivedTick", () => {
    expect(decideRestart({
      ...baseDecision,
      currentTick: 51,
      lastReceivedTick: 50,
      wipeMarkerTick: 49,
    })).toEqual({ kind: "send-current", caseName: "B", resend: false });
  });

  // The wipeMarkerTick=0 case is interesting because readWipeMarker can
  // return 0 from an empty/whitespace-only marker file (documented below).
  // Guard against a `>=` regression here: 0 > 0 must be false.
  it("treats wipeMarkerTick=0 with lastReceivedTick=0 as wait, not reset", () => {
    expect(decideRestart({
      ...baseDecision,
      currentTick: 0,
      lastReceivedTick: 0,
      wipeMarkerTick: 0,
    })).toEqual({ kind: "wait", caseName: "A" });
  });

  it("treats wipeMarkerTick=0 with positive lastReceivedTick as a stale marker (wait/send, not reset)", () => {
    const result = decideRestart({
      ...baseDecision,
      currentTick: 10,
      lastReceivedTick: 9,
      wipeMarkerTick: 0,
    });
    expect(result.kind).not.toBe("reset");
  });
});

describe("decideRestart — currentTick & lastReceivedTick extremes", () => {
  it("waits when both currentTick and lastReceivedTick are 0", () => {
    expect(decideRestart({
      ...baseDecision,
      currentTick: 0,
      lastReceivedTick: 0,
    })).toEqual({ kind: "wait", caseName: "A" });
  });

  it("sends fresh when currentTick=1 and lastReceivedTick=0 (gap of exactly 1)", () => {
    expect(decideRestart({
      ...baseDecision,
      currentTick: 1,
      lastReceivedTick: 0,
    })).toEqual({ kind: "send-current", caseName: "B", resend: false });
  });

  it("waits when lastReceivedTick is AHEAD of currentTick (negative gap, e.g. tick rollback)", () => {
    // Pathological: convex reports lastReceivedTick higher than chain
    // currentTick. Guard `gap <= 0` covers this; defend against a future
    // regression to `gap < 0` that would mis-classify rollback as gap=0 send.
    expect(decideRestart({
      ...baseDecision,
      currentTick: 5,
      lastReceivedTick: 8,
    })).toEqual({ kind: "wait", caseName: "A" });
  });

  it("fast-forwards across MAX_SAFE_INTEGER-ish ticks without crashing", () => {
    // No memory-wipe interval that lines up, so should fast-forward.
    const result = decideRestart({
      ...baseDecision,
      currentTick: Number.MAX_SAFE_INTEGER,
      lastReceivedTick: Number.MAX_SAFE_INTEGER - 1,
    });
    expect(result).toEqual({
      kind: "send-current",
      caseName: "B",
      resend: false,
    });
  });
});

describe("decideRestart — memoryWipeTickInterval boundary surface", () => {
  it("interval=1 makes every gap>1 a memory-wipe gap (every tick is a wipe)", () => {
    expect(decideRestart({
      ...baseDecision,
      currentTick: 5,
      lastReceivedTick: 2,
      memoryWipeTickInterval: 1,
    })).toEqual({ kind: "reset", caseName: "D", reason: "memory_wipe_gap" });
  });

  it("interval=0 disables memory-wipe detection (fast-forward instead of reset)", () => {
    expect(decideRestart({
      ...baseDecision,
      currentTick: 200,
      lastReceivedTick: 10,
      memoryWipeTickInterval: 0,
    })).toEqual({
      kind: "fast-forward",
      caseName: "E",
      fromTick: 10,
      toTick: 200,
    });
  });

  it("negative interval is treated as disabled (no reset)", () => {
    expect(decideRestart({
      ...baseDecision,
      currentTick: 200,
      lastReceivedTick: 10,
      memoryWipeTickInterval: -50,
    }).kind).toBe("fast-forward");
  });

  it("NaN interval is treated as disabled (no reset)", () => {
    expect(decideRestart({
      ...baseDecision,
      currentTick: 200,
      lastReceivedTick: 10,
      memoryWipeTickInterval: Number.NaN,
    }).kind).toBe("fast-forward");
  });

  it("Infinity interval is treated as disabled (no reset)", () => {
    expect(decideRestart({
      ...baseDecision,
      currentTick: 200,
      lastReceivedTick: 10,
      memoryWipeTickInterval: Number.POSITIVE_INFINITY,
    }).kind).toBe("fast-forward");
  });
});

describe("containsMemoryWipeTick — exact-boundary scan", () => {
  it("returns true when currentTick IS the wipe tick (inclusive upper bound)", () => {
    expect(containsMemoryWipeTick(49, 50, 50)).toBe(true);
  });

  it("returns false when lastReceivedTick IS the wipe tick (exclusive lower bound)", () => {
    // Gap is (50, 51, 52, ..., 99] — none divisible by 50 (next is 100).
    expect(containsMemoryWipeTick(50, 99, 50)).toBe(false);
  });

  it("returns false when window is exactly one tick wide and it's not a wipe", () => {
    expect(containsMemoryWipeTick(7, 8, 50)).toBe(false);
  });

  it("returns false when lastReceivedTick == currentTick (zero-width window)", () => {
    expect(containsMemoryWipeTick(50, 50, 50)).toBe(false);
  });

  it("skips tick=0 even when interval divides it (tick>0 guard)", () => {
    // Window (-1, 0]. tick starts at 0; 0 % 50 === 0 but tick>0 guard kicks.
    expect(containsMemoryWipeTick(-1, 0, 50)).toBe(false);
  });
});

describe("isScheduledMemoryWipeTick — guard combinations", () => {
  it("tick=0 is never a wipe tick (game-start exception)", () => {
    expect(isScheduledMemoryWipeTick(0, 50)).toBe(false);
  });

  it("negative tick is never a wipe tick", () => {
    expect(isScheduledMemoryWipeTick(-50, 50)).toBe(false);
  });

  it("tick == interval is a wipe tick (first scheduled wipe)", () => {
    expect(isScheduledMemoryWipeTick(50, 50)).toBe(true);
  });

  it("NaN interval is not a wipe tick", () => {
    expect(isScheduledMemoryWipeTick(50, Number.NaN)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// deriveHealth threshold edges
// ─────────────────────────────────────────────────────────────────────────────

describe("deriveHealth — exact-threshold edges", () => {
  function state(overrides: Partial<HeartbeatState> = {}): HeartbeatState {
    return {
      lastTickProcessed: 0,
      lastSuccessAt: 0,
      consecutiveErrors: 0,
      ...overrides,
    };
  }

  it("staleSec exactly 90.0 is still green (strict >90)", () => {
    expect(deriveHealth(state({ lastSuccessAt: 0 }), 90_000)).toBe("green");
  });

  it("staleSec just above 90 (90.001s) flips to yellow", () => {
    expect(deriveHealth(state({ lastSuccessAt: 0 }), 90_001)).toBe("yellow");
  });

  it("staleSec exactly 180.0 is still yellow (strict >180)", () => {
    expect(deriveHealth(state({ lastSuccessAt: 0 }), 180_000)).toBe("yellow");
  });

  it("staleSec just above 180 (180.001s) flips to red", () => {
    expect(deriveHealth(state({ lastSuccessAt: 0 }), 180_001)).toBe("red");
  });

  it("consecutiveErrors=2 is yellow (boundary below 3)", () => {
    expect(deriveHealth(state({ consecutiveErrors: 2 }), 0)).toBe("yellow");
  });

  it("consecutiveErrors=3 is red (boundary at 3)", () => {
    expect(deriveHealth(state({ consecutiveErrors: 3 }), 0)).toBe("red");
  });

  it("negative staleSec (clock skew, nowMs < lastSuccessAt) stays green", () => {
    // Defends against future NTP-skew regression that would compute very-
    // negative staleSec and accidentally pass a positive >90 check.
    expect(deriveHealth(state({ lastSuccessAt: 1_000_000 }), 0)).toBe("green");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// composeMessage — empty/edge collections + tick=0 boundary
// ─────────────────────────────────────────────────────────────────────────────

describe("composeMessage — empty + tick-boundary inputs", () => {
  it("throws when called with no tick, no templates, no messages", () => {
    expect(() => composeMessage({})).toThrow("cannot compose empty runner message");
  });

  it("throws on empty arrays for both message buckets and no tick", () => {
    expect(() => composeMessage({
      userMessages: [],
      adminMessages: [],
    })).toThrow("cannot compose empty runner message");
  });

  it("emits tick:0 (not skipped — tickNumber !== undefined check)", () => {
    const result = composeMessage({ tickNumber: 0 });
    expect(result.text).toBe("tick: 0");
  });

  it("composes a tick-only section when templates are all whitespace", () => {
    const result = composeMessage({
      tickNumber: 5,
      templates: [
        { fileName: "00.md", content: "   \n\t\n" },
        { fileName: "01.md", content: "" },
      ],
    });
    expect(result.text).toBe("tick: 5");
  });

  it("preserves fastForwardPrefix when templates are empty", () => {
    const result = composeMessage({
      tickNumber: 5,
      fastForwardPrefix: "[fast-forward 3→5]",
      templates: [],
    });
    expect(result.text).toBe("tick: 5\n[fast-forward 3→5]");
  });

  it("messageHash is deterministic and 64-char hex", () => {
    const a = composeMessage({ tickNumber: 42 });
    const b = composeMessage({ tickNumber: 42 });
    expect(a.messageHash).toBe(b.messageHash);
    expect(a.messageHash).toMatch(/^[0-9a-f]{64}$/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// settingsCache — comparison-edge surface
// ─────────────────────────────────────────────────────────────────────────────

describe("settingsEqual / describeSettingsDrift edges", () => {
  it("returns 'no drift' literal string for identical settings", () => {
    expect(describeSettingsDrift(baseSettings, { ...baseSettings })).toBe("no drift");
  });

  it("ignores keys outside the stable() allowlist (e.g. extra/unknown keys)", () => {
    // Defends the snapshot contract — adding an unknown key to an incoming
    // settings blob should not be flagged as drift.
    const noise = { ...baseSettings, surpriseField: "ignored" } as GameSettings & {
      surpriseField: string;
    };
    expect(settingsEqual(baseSettings, noise)).toBe(true);
    expect(describeSettingsDrift(baseSettings, noise)).toBe("no drift");
  });

  it("describes drift for every changed key, not just the first", () => {
    const changed: GameSettings = {
      ...baseSettings,
      memoryWipeTickInterval: 60,
      winterStartTick: 200,
    };
    const drift = describeSettingsDrift(baseSettings, changed);
    expect(drift).toContain("memoryWipeTickInterval");
    expect(drift).toContain("winterStartTick");
  });

  it("treats 0 and -0 as equal (JSON.stringify normalizes)", () => {
    const a: GameSettings = { ...baseSettings, winterStartTick: 0 };
    const b: GameSettings = { ...baseSettings, winterStartTick: -0 };
    expect(settingsEqual(a, b)).toBe(true);
  });

  it("flags drift when a numeric field changes by 1 (smallest possible diff)", () => {
    const off = { ...baseSettings, memoryWipeTickInterval: 51 };
    expect(settingsEqual(baseSettings, off)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// wipeMarker — file-content boundary surface
// ─────────────────────────────────────────────────────────────────────────────

describe("wipeMarker — input-coercion boundaries", () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "wipe-marker-boundary-"));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("reads tick=0 (boundary of the >=0 acceptance check)", () => {
    const marker = path.join(dir, "marker");
    writeWipeMarker(marker, 0);
    expect(readWipeMarker(marker)).toBe(0);
  });

  it("reads MAX_SAFE_INTEGER without precision loss", () => {
    const marker = path.join(dir, "marker");
    writeWipeMarker(marker, Number.MAX_SAFE_INTEGER);
    expect(readWipeMarker(marker)).toBe(Number.MAX_SAFE_INTEGER);
  });

  it("rejects a negative-number marker file (returns null)", () => {
    const marker = path.join(dir, "marker");
    fs.writeFileSync(marker, "-1\n");
    expect(readWipeMarker(marker)).toBe(null);
  });

  it("rejects a decimal marker file (returns null)", () => {
    const marker = path.join(dir, "marker");
    fs.writeFileSync(marker, "12.5\n");
    expect(readWipeMarker(marker)).toBe(null);
  });

  it("rejects a non-numeric marker file (returns null)", () => {
    const marker = path.join(dir, "marker");
    fs.writeFileSync(marker, "garbage\n");
    expect(readWipeMarker(marker)).toBe(null);
  });

  it("returns null for a missing file (no throw)", () => {
    expect(readWipeMarker(path.join(dir, "does-not-exist"))).toBe(null);
  });

  it("clearWipeMarker is idempotent — safe to call on a missing file", () => {
    const marker = path.join(dir, "marker");
    expect(() => clearWipeMarker(marker)).not.toThrow();
    expect(() => clearWipeMarker(marker)).not.toThrow();
  });

  // ── Known-quirk documentation (not asserting bug, asserting current behavior).
  // Empty file and whitespace-only file both coerce through Number() to 0,
  // which then satisfies Number.isInteger && >=0, so reader returns 0 not
  // null. Caller decideRestart treats wipeMarkerTick=0 with lastReceivedTick
  // >0 as harmless (covered above) so this is currently safe, but the
  // assumption is load-bearing — flag if it ever breaks.
  it("empty marker file currently reads as tick=0 (load-bearing quirk)", () => {
    const marker = path.join(dir, "marker");
    fs.writeFileSync(marker, "");
    expect(readWipeMarker(marker)).toBe(0);
  });

  it("whitespace-only marker file currently reads as tick=0 (load-bearing quirk)", () => {
    const marker = path.join(dir, "marker");
    fs.writeFileSync(marker, "   \n  \t\n");
    expect(readWipeMarker(marker)).toBe(0);
  });
});
