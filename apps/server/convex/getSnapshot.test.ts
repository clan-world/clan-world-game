import { describe, expect, it } from "vitest";
import {
  deriveSeasonState,
  getSnapshot,
  normalizePausedAtTs,
  resolveHeartbeatIntervalSecondsForSnap,
  resolvePauseStateForSnap,
  resolveSeasonStateForSnap,
  type PersistedSnapshotSeasonFields,
} from "./getSnapshot";

// Constants from packages/shared/src/generated/constants.ts (mirrors chain).
const SEASON_LEN = 360;
const WINTER_START = 110;
const WINTER_DUR = 10;

function createDb(tables: Record<string, any[]> = {}) {
  return {
    query(table: string) {
      let rows = [...(tables[table] ?? [])];
      const builder = {
        withIndex(_name: string, apply: (q: any) => unknown) {
          const clauses: Array<{ field: string; value: unknown }> = [];
          const q = {
            eq(field: string, value: unknown) {
              clauses.push({ field, value });
              return q;
            },
          };
          apply(q);
          rows = rows.filter((row) =>
            clauses.every((clause) => row[clause.field] === clause.value),
          );
          return builder;
        },
        order(direction: "asc" | "desc") {
          rows = [...rows].sort((a, b) =>
            direction === "desc"
              ? (b._creationTime ?? 0) - (a._creationTime ?? 0)
              : (a._creationTime ?? 0) - (b._creationTime ?? 0),
          );
          return builder;
        },
        async first() {
          return rows[0] ?? null;
        },
      };
      return builder;
    },
  };
}

describe("resolveSeasonStateForSnap (issue #435 regression)", () => {
  it("season-freeze window: tick === seasonEndTick && !seasonFinalized returns persisted OLD season, NOT derived next season", () => {
    // Regression for the bug filed as issue #435 from PR #432 super-swarm.
    // At tick === SEASON_DURATION_TICKS the contract holds
    // `currentSeasonNumber = 1`, `seasonStartTick = 0`, `seasonEndTick = 360`
    // until `finalizeSeason()` is invoked. The pre-fix resolver derived
    // season 2 from `Math.floor(tick / SEASON_LEN)` and overwrote the
    // persisted values, surfacing the NEXT season in HUD/winter UI one
    // tick early. See:
    //   - packages/contracts/src/ClanWorld.sol:3188-3199
    //   - packages/contracts/test/HeartbeatOrdering.t.sol:447-452
    const snap: PersistedSnapshotSeasonFields = {
      tick: SEASON_LEN,
      currentSeasonNumber: 1,
      seasonStartTick: 0,
      seasonEndTick: SEASON_LEN,
      seasonFinalized: false,
      winterActive: false,
      winterStartsAtTick: WINTER_START,
      winterEndsAtTick: WINTER_START + WINTER_DUR,
    };

    const result = resolveSeasonStateForSnap(snap);

    // Persisted OLD season values win — this is the freeze-window assertion.
    expect(result.currentSeasonNumber).toBe(1);
    expect(result.seasonStartTick).toBe(0);
    expect(result.seasonEndTick).toBe(SEASON_LEN);
    // Anti-assertion: the buggy derived values must NOT leak through.
    expect(result.currentSeasonNumber).not.toBe(2);
    expect(result.seasonStartTick).not.toBe(SEASON_LEN);
    expect(result.seasonEndTick).not.toBe(SEASON_LEN * 2);
    // Winter fields pass through from persisted row.
    expect(result.winterActive).toBe(false);
    expect(result.winterStartsAtTick).toBe(WINTER_START);
    expect(result.winterEndsAtTick).toBe(WINTER_START + WINTER_DUR);
  });

  it("mid-season: returns persisted season/winter fields exactly", () => {
    const snap: PersistedSnapshotSeasonFields = {
      tick: 100,
      currentSeasonNumber: 1,
      seasonStartTick: 0,
      seasonEndTick: SEASON_LEN,
      winterActive: false,
      winterStartsAtTick: WINTER_START,
      winterEndsAtTick: WINTER_START + WINTER_DUR,
    };

    const result = resolveSeasonStateForSnap(snap);

    expect(result.currentSeasonNumber).toBe(1);
    expect(result.seasonStartTick).toBe(0);
    expect(result.seasonEndTick).toBe(SEASON_LEN);
    expect(result.winterActive).toBe(false);
    expect(result.winterStartsAtTick).toBe(WINTER_START);
    expect(result.winterEndsAtTick).toBe(WINTER_START + WINTER_DUR);
  });

  it("legacy row with missing optional season fields: falls back to derive per-field", () => {
    // Pre-Phase-4.4 rows did not persist these fields. The resolver must
    // still return sensible derived values for those specific missing
    // fields without disturbing whatever is persisted.
    const snap: PersistedSnapshotSeasonFields = {
      tick: 50,
      // No optional season/winter fields persisted (legacy row).
    };

    const result = resolveSeasonStateForSnap(snap);

    // All six fields come from deriveSeasonState(50).
    expect(result.currentSeasonNumber).toBe(1);
    expect(result.seasonStartTick).toBe(0);
    expect(result.seasonEndTick).toBe(SEASON_LEN);
    expect(result.winterActive).toBe(false);
    expect(result.winterStartsAtTick).toBe(WINTER_START);
    expect(result.winterEndsAtTick).toBe(WINTER_START + WINTER_DUR);
  });

  it("partial legacy row: persisted fields win, missing fields fall back to derive", () => {
    // Mixed case — persisted seasonStartTick + seasonEndTick but no
    // currentSeasonNumber or winter fields. The resolver must NOT
    // recompute the persisted fields, but MUST derive the missing ones.
    const snap: PersistedSnapshotSeasonFields = {
      tick: SEASON_LEN,
      seasonStartTick: 0,
      seasonEndTick: SEASON_LEN,
      // No currentSeasonNumber → derive returns 2 here, freeze unaware
      // since the row predates the persisted-currentSeasonNumber field.
      // This is acceptable: legacy rows pay the legacy cost. Current
      // rows always persist all six fields, so this case is rare.
    };

    const result = resolveSeasonStateForSnap(snap);

    expect(result.seasonStartTick).toBe(0);
    expect(result.seasonEndTick).toBe(SEASON_LEN);
    // Derived for missing field.
    expect(result.currentSeasonNumber).toBe(2);
    expect(result.winterActive).toBe(false);
  });
});

describe("deriveSeasonState (empty-state fallback)", () => {
  it("tick 0: season 1, no winter active yet", () => {
    const result = deriveSeasonState(0);

    expect(result.currentSeasonNumber).toBe(1);
    expect(result.seasonStartTick).toBe(0);
    expect(result.seasonEndTick).toBe(SEASON_LEN);
    expect(result.winterActive).toBe(false);
    // Pre-WINTER_START_TICK, the next winter starts at WINTER_START.
    expect(result.winterStartsAtTick).toBe(WINTER_START);
    expect(result.winterEndsAtTick).toBe(WINTER_START + WINTER_DUR);
  });

  it("tick inside first winter window: winterActive=true", () => {
    // WINTER_START=110, WINTER_DUR=10 → ticks 110..119 are first winter.
    const result = deriveSeasonState(WINTER_START + 5);

    expect(result.winterActive).toBe(true);
    expect(result.winterStartsAtTick).toBe(WINTER_START);
    expect(result.winterEndsAtTick).toBe(WINTER_START + WINTER_DUR);
  });

  it("tick just past first winter: winterActive=false, next winter pre-computed", () => {
    // WINTER_PERIOD=110, so next winter starts at WINTER_START + 110 = 220.
    const result = deriveSeasonState(WINTER_START + WINTER_DUR + 1);

    expect(result.winterActive).toBe(false);
    expect(result.winterStartsAtTick).toBe(WINTER_START + 110);
    expect(result.winterEndsAtTick).toBe(WINTER_START + 110 + WINTER_DUR);
  });
});

describe("normalizePausedAtTs", () => {
  it("paused row: preserves a positive pausedAtTs", () => {
    expect(resolvePauseStateForSnap({ worldPaused: true, pausedAtTs: 12345 })).toEqual({
      worldPaused: true,
      pausedAtTs: 12345,
    });
  });

  it("unpaused row: normalizes missing or non-positive pausedAtTs to null", () => {
    expect(resolvePauseStateForSnap({ worldPaused: false, pausedAtTs: undefined })).toEqual({
      worldPaused: false,
      pausedAtTs: null,
    });
    expect(resolvePauseStateForSnap({ worldPaused: false, pausedAtTs: 0 })).toEqual({
      worldPaused: false,
      pausedAtTs: null,
    });
    expect(normalizePausedAtTs(undefined)).toBeNull();
    expect(normalizePausedAtTs(0)).toBeNull();
  });

  it("paused row: normalizes zero pausedAtTs to null", () => {
    expect(resolvePauseStateForSnap({ worldPaused: true, pausedAtTs: 0 })).toEqual({
      worldPaused: true,
      pausedAtTs: null,
    });
  });

  it("unpaused row: hides stale positive pausedAtTs", () => {
    expect(resolvePauseStateForSnap({ worldPaused: false, pausedAtTs: 12345 })).toEqual({
      worldPaused: false,
      pausedAtTs: null,
    });
  });
});

describe("resolveHeartbeatIntervalSecondsForSnap", () => {
  it("prefers persisted on-chain heartbeatIntervalSeconds", () => {
    expect(resolveHeartbeatIntervalSecondsForSnap({
      heartbeatIntervalSeconds: 45,
      tickEpochDurationMs: 60_000,
    })).toBe(45);
  });

  it("falls back to legacy tickEpochDurationMs", () => {
    expect(resolveHeartbeatIntervalSecondsForSnap({
      tickEpochDurationMs: 30_000,
    })).toBe(30);
  });
});

describe("getSnapshot heartbeat interval", () => {
  it("returns the latest persisted on-chain heartbeatIntervalSeconds", async () => {
    const db = createDb({
      worldSnapshot: [
        {
          _creationTime: 1,
          tick: 8,
          heartbeatIntervalSeconds: 60,
          tickEpochStartedAt: 1_000,
          tickEpochDurationMs: 60_000,
          regions: [],
          clans: [],
          activeBanditId: 0,
        },
        {
          _creationTime: 2,
          tick: 8,
          heartbeatIntervalSeconds: 45,
          tickEpochStartedAt: 2_000,
          tickEpochDurationMs: 60_000,
          regions: [],
          clans: [],
          activeBanditId: 0,
        },
      ],
    });

    const result = await (getSnapshot as any)._handler({ db });

    expect(result.heartbeatIntervalSeconds).toBe(45);
    expect(result.tickEpoch.durationMs).toBe(60_000);
  });
});
