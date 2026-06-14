import { describe, expect, it } from "vitest";
import { deriveEtaTs } from "./clansmen";

// Mutation date: 2026-06-14. These tests pin the etaTs projection added in
// PR #676 (super-swarm M2). Each case fails if the derivation is reverted:
//  - drop the `tickEpochStartedAt <= 0` guard → the "missing epoch" case
//    returns a relative-to-zero timestamp instead of null (FAILS).
//  - drop the `eta === null` guard → the idle/dead case projects a bogus time
//    instead of null (FAILS).
//  - change the formula (e.g. use `eta` instead of `settlesAtTick`, or forget
//    to multiply by tickDurationSeconds) → the normal + past cases mismatch
//    (FAILS).
describe("deriveEtaTs", () => {
  const EPOCH = 1_700_000_000; // arbitrary unix-seconds tick-epoch start
  const TICK_SECONDS = 30;

  it("projects settlesAtTick onto the tick epoch for an active mission", () => {
    // settles at tick 100, epoch starts at EPOCH, 30s/tick.
    const etaTs = deriveEtaTs(/* eta */ 5, /* settlesAtTick */ 100, EPOCH, TICK_SECONDS);
    expect(etaTs).toBe(EPOCH + 100 * TICK_SECONDS);
  });

  it("returns null when eta is null (idle / dead — no live mission)", () => {
    expect(deriveEtaTs(null, 100, EPOCH, TICK_SECONDS)).toBeNull();
  });

  it("falls back to null when the tick epoch is missing/zero (not NaN/garbage)", () => {
    // tickEpochStartedAt unset (0) — projection would otherwise be a bogus
    // 1970-relative timestamp; we must return null so the tab falls back to the
    // relative-ticks label.
    const etaTs = deriveEtaTs(5, 100, 0, TICK_SECONDS);
    expect(etaTs).toBeNull();
    // Negative/garbage epoch is treated the same way.
    expect(deriveEtaTs(5, 100, -1, TICK_SECONDS)).toBeNull();
    // Sanity: never NaN under the normal path either.
    expect(Number.isNaN(deriveEtaTs(5, 100, EPOCH, TICK_SECONDS) as number)).toBe(false);
  });

  it("still derives a (past) timestamp for a settle tick that already elapsed", () => {
    // settlesAtTick = 1 with a far-future caller "now" → a settle in the past.
    // The derivation is purely epoch-relative, so it should produce the real
    // (past) wall-clock seconds; the UI layer (renderEta) is what shows "due".
    const etaTs = deriveEtaTs(0, 1, EPOCH, TICK_SECONDS);
    expect(etaTs).toBe(EPOCH + 1 * TICK_SECONDS);
    expect(etaTs! < EPOCH + 100 * TICK_SECONDS).toBe(true);
  });
});
