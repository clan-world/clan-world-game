import { describe, expect, it } from "vitest";
import { deriveEtaTs } from "./clansmen";

// Mutation date: 2026-06-14 (r2). These tests pin the etaTs projection added in
// PR #676 (super-swarm M2) and corrected in r2 (C1). Each case fails if the
// derivation is reverted:
//  - drop the `tickEpochStartedAt <= 0` guard → the "missing epoch" case
//    returns a relative-to-zero timestamp instead of null (FAILS).
//  - drop the `eta === null` guard → the idle/dead case projects a bogus time
//    instead of null (FAILS).
//  - revert to the pre-r2 (no-currentTick) formula
//    `tickEpochStartedAt + settlesAtTick * tickDurationSeconds` → the
//    "2 ticks in the future" + normal + past cases mismatch (FAILS). This is
//    the C1 mutation guard: tickEpochStartedAt is *when the current tick began*,
//    so the projection MUST be relative to currentTick.
describe("deriveEtaTs", () => {
  const EPOCH = 1_700_000_000; // unix-seconds — when the CURRENT tick began
  const TICK_SECONDS = 30;

  it("projects settlesAtTick relative to currentTick onto the tick epoch", () => {
    // Current tick is 90, settles at tick 100 → 10 ticks out from now.
    const currentTick = 90;
    const etaTs = deriveEtaTs(/* eta */ 10, /* settlesAtTick */ 100, currentTick, EPOCH, TICK_SECONDS);
    expect(etaTs).toBe(EPOCH + (100 - currentTick) * TICK_SECONDS);
    // Concretely: 10 ticks * 30s from the current-tick epoch.
    expect(etaTs).toBe(EPOCH + 300);
  });

  it("a settle 2 ticks in the future yields ~= now + 2*tickDuration (NOT epoch + settlesAtTick*duration)", () => {
    // C1 regression guard. With currentTick large (1000) and settle 2 ticks out,
    // the CORRECT projection is epoch + 2*tickDuration. The pre-r2 formula would
    // have produced epoch + 1002*tickDuration — hours off — so this case fails
    // if the no-currentTick formula is restored.
    const currentTick = 1000;
    const settlesAtTick = currentTick + 2;
    const etaTs = deriveEtaTs(/* eta */ 2, settlesAtTick, currentTick, EPOCH, TICK_SECONDS);
    expect(etaTs).toBe(EPOCH + 2 * TICK_SECONDS); // now + 2 ticks
    // Explicitly NOT the old epoch-from-tick-0 formula:
    expect(etaTs).not.toBe(EPOCH + settlesAtTick * TICK_SECONDS);
  });

  it("returns null when eta is null (idle / dead — no live mission)", () => {
    expect(deriveEtaTs(null, 100, 90, EPOCH, TICK_SECONDS)).toBeNull();
  });

  it("falls back to null when the tick epoch is missing/zero (not NaN/garbage)", () => {
    // tickEpochStartedAt unset (0) — projection would otherwise be a bogus
    // 1970-relative timestamp; we must return null so the tab falls back to the
    // relative-ticks label.
    const etaTs = deriveEtaTs(5, 100, 90, 0, TICK_SECONDS);
    expect(etaTs).toBeNull();
    // Negative/garbage epoch is treated the same way.
    expect(deriveEtaTs(5, 100, 90, -1, TICK_SECONDS)).toBeNull();
    // Sanity: never NaN under the normal path either.
    expect(Number.isNaN(deriveEtaTs(5, 100, 90, EPOCH, TICK_SECONDS) as number)).toBe(false);
  });

  it("derives a (past) timestamp for a settle tick that already elapsed", () => {
    // settlesAtTick is *behind* currentTick → settle in the past. The derivation
    // is purely epoch-relative, so it produces real (past) wall-clock seconds
    // (negative offset); the UI layer (renderEta) is what shows "due".
    const currentTick = 100;
    const settlesAtTick = 98; // 2 ticks ago
    const etaTs = deriveEtaTs(0, settlesAtTick, currentTick, EPOCH, TICK_SECONDS);
    expect(etaTs).toBe(EPOCH - 2 * TICK_SECONDS);
    expect(etaTs! < EPOCH).toBe(true);
  });
});
