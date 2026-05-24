/**
 * Boundary-condition test suite (Agent B of test-improvement experiment).
 *
 * Targets tick/season/winter boundaries and pagination/scan-window edges
 * that have one-line "off by one" / "exact equals" classes of bugs. Each
 * test focuses on EXACT boundary values (not "around" them), so a future
 * regression at the boundary line (>= vs >, < vs <=, < safeLatest vs
 * <= safeLatest) is caught immediately.
 *
 * Sources cross-checked while writing these:
 *   - convex/heartbeat.ts          (advanceTick season-crossing logic)
 *   - convex/getSnapshot.ts        (deriveSeasonState winter window math)
 *   - convex/indexer.ts            (planPollLogRange + shouldScheduleEventDrivenRefresh)
 *   - convex/runner.ts             (UID_SCAN_LIMIT linear scan)
 *   - packages/sdk/src/generated/constants.ts
 *
 * Constants asserted: SEASON_LEN=360, WINTER_START=110, WINTER_DUR=10,
 * WINTER_PERIOD=110, UID_SCAN_LIMIT=5000, MAX_LOG_BLOCK_RANGE=9.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  deriveSeasonState,
  resolveSeasonStateForSnap,
  type PersistedSnapshotSeasonFields,
} from "./getSnapshot";
import { advanceTick } from "./heartbeat";
import {
  planPollLogRange,
  shouldScheduleEventDrivenRefresh,
} from "./indexer";
import {
  hasMessageUidReceive,
  isThematicUidTaken,
  getRunnerStartupState,
} from "./runner";

const SEASON_LEN = 360;
const WINTER_START = 110;
const WINTER_DUR = 10;
const WINTER_PERIOD = 110;

// -----------------------------------------------------------------------
// Shared in-memory Convex-like DB harness (matches the pattern used by
// runner.test.ts + advanceTick.test.ts). Kept here local to avoid coupling
// the new suite to private test helpers from other files.
// -----------------------------------------------------------------------
function createDb(tables: Record<string, any[]> = {}) {
  return {
    tables,
    db: {
      async insert(table: string, value: Record<string, unknown>) {
        tables[table] ??= [];
        const doc = {
          ...value,
          _id: `${table}:${tables[table].length}`,
          _creationTime: Date.now() + tables[table].length,
        };
        tables[table].push(doc);
        return doc._id;
      },
      async patch(id: string, updates: Record<string, unknown>) {
        for (const list of Object.values(tables)) {
          const idx = list.findIndex((row: any) => row._id === id);
          if (idx >= 0) {
            list[idx] = { ...list[idx], ...updates };
            return;
          }
        }
        throw new Error(`patch: id not found ${id}`);
      },
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
          async take(n: number) {
            return rows.slice(0, n);
          },
        };
        return builder;
      },
    },
  };
}

function call(fn: any, db: any, args?: any) {
  return fn._handler({ db }, args);
}

// =======================================================================
// deriveSeasonState — winter window EXACT boundaries
// =======================================================================
//
// Existing tests in getSnapshot.test.ts cover "WINTER_START+5" (mid-window)
// and "WINTER_START+WINTER_DUR+1" (just past). These tests pin the EXACT
// first-tick-of-winter, LAST-tick-of-winter, and FIRST-tick-after-winter
// boundaries — the "< WINTER_DUR" condition in getSnapshot.ts:60 has
// historically been a `<=` candidate (mirrors LibSeason.isWinterActive)
// and any flip there silently extends winter by one tick.
describe("deriveSeasonState — exact winter boundaries", () => {
  it("tick === WINTER_START (first winter tick): winterActive=true, winterStartsAtTick === WINTER_START", () => {
    // Boundary: cycleOffset = (110 - 110) % 110 = 0; 0 < WINTER_DUR(10) → active.
    const result = deriveSeasonState(WINTER_START);
    expect(result.winterActive).toBe(true);
    expect(result.winterStartsAtTick).toBe(WINTER_START);
    expect(result.winterEndsAtTick).toBe(WINTER_START + WINTER_DUR);
  });

  it("tick === WINTER_START + WINTER_DUR - 1 (last winter tick): winterActive=true", () => {
    // Boundary: cycleOffset = 9; 9 < WINTER_DUR(10) → still active.
    // If condition flips to `<=`, this stays correct but the next test fails.
    const result = deriveSeasonState(WINTER_START + WINTER_DUR - 1);
    expect(result.winterActive).toBe(true);
    expect(result.winterStartsAtTick).toBe(WINTER_START);
  });

  it("tick === WINTER_START + WINTER_DUR (FIRST tick after winter): winterActive=false, NEXT winter pre-computed", () => {
    // Boundary: cycleOffset = 10; 10 < WINTER_DUR(10) is FALSE → inactive.
    // If predicate is `<=` instead of `<`, this tick would still report active
    // and the chain would have already exited winter. Strict-less guard catch.
    const result = deriveSeasonState(WINTER_START + WINTER_DUR);
    expect(result.winterActive).toBe(false);
    // Inactive branch: winterStartsAtTick = cycleStart + WINTER_PERIOD = 110 + 110 = 220.
    expect(result.winterStartsAtTick).toBe(WINTER_START + WINTER_PERIOD);
    expect(result.winterEndsAtTick).toBe(WINTER_START + WINTER_PERIOD + WINTER_DUR);
  });

  it("tick === WINTER_START - 1 (one tick before first winter): inactive, winterStartsAtTick === WINTER_START", () => {
    // Pre-WINTER_START branch (tick < WINTER_START) — exercises the else
    // branch separately from the cyclic branch.
    const result = deriveSeasonState(WINTER_START - 1);
    expect(result.winterActive).toBe(false);
    expect(result.winterStartsAtTick).toBe(WINTER_START);
    expect(result.winterEndsAtTick).toBe(WINTER_START + WINTER_DUR);
  });

  it("tick === WINTER_START + WINTER_PERIOD (start of SECOND winter cycle): winterActive=true", () => {
    // Verifies the cyclic math (cycleIndex=1, cycleOffset=0).
    const result = deriveSeasonState(WINTER_START + WINTER_PERIOD);
    expect(result.winterActive).toBe(true);
    expect(result.winterStartsAtTick).toBe(WINTER_START + WINTER_PERIOD);
    expect(result.winterEndsAtTick).toBe(WINTER_START + WINTER_PERIOD + WINTER_DUR);
  });
});

// =======================================================================
// deriveSeasonState — season boundary EXACT ticks
// =======================================================================
describe("deriveSeasonState — exact season boundaries", () => {
  it("tick === SEASON_LEN - 1 (last tick of season 1): season 1, seasonEndTick=360", () => {
    const result = deriveSeasonState(SEASON_LEN - 1);
    expect(result.currentSeasonNumber).toBe(1);
    expect(result.seasonStartTick).toBe(0);
    expect(result.seasonEndTick).toBe(SEASON_LEN);
  });

  it("tick === SEASON_LEN (FIRST tick of season 2 by raw derive): season 2", () => {
    // Raw derive promotes immediately at tick === SEASON_LEN. The
    // freeze-window protection lives in resolveSeasonStateForSnap, not here.
    const result = deriveSeasonState(SEASON_LEN);
    expect(result.currentSeasonNumber).toBe(2);
    expect(result.seasonStartTick).toBe(SEASON_LEN);
    expect(result.seasonEndTick).toBe(SEASON_LEN * 2);
  });
});

// =======================================================================
// resolveSeasonStateForSnap — freeze window protection at EXACT boundary
// =======================================================================
describe("resolveSeasonStateForSnap — exact freeze-window boundaries", () => {
  it("tick === seasonEndTick && seasonFinalized=true: STILL returns persisted (NOT advanced) — finalize ran but next snapshot not yet committed", () => {
    // The freeze-window guard is "use persisted whenever present", regardless
    // of seasonFinalized — derived fallback is per-field only when persisted
    // is undefined. Pin the exact-equals case.
    const snap: PersistedSnapshotSeasonFields = {
      tick: SEASON_LEN,
      currentSeasonNumber: 1,
      seasonStartTick: 0,
      seasonEndTick: SEASON_LEN,
      seasonFinalized: true,
      winterActive: false,
      winterStartsAtTick: WINTER_START,
      winterEndsAtTick: WINTER_START + WINTER_DUR,
    };
    const result = resolveSeasonStateForSnap(snap);
    expect(result.currentSeasonNumber).toBe(1);
    expect(result.seasonStartTick).toBe(0);
    expect(result.seasonEndTick).toBe(SEASON_LEN);
  });
});

// =======================================================================
// advanceTick — synthetic tick lands EXACTLY on seasonEndTick
// =======================================================================
//
// heartbeat.ts:300 uses `newTick > prevSnap.seasonEndTick` (strict). When
// newTick lands EXACTLY on seasonEndTick (the last tick of the current
// season), boundary is NOT crossed — season fields must be preserved.
// One-tick later (newTick = seasonEndTick + 1) IS crossed.
describe("advanceTick — exact season-boundary off-by-one", () => {
  const NOW_SECONDS = 1_700_000_000;
  const baseSnap = {
    tickEpochStartedAt: NOW_SECONDS - 120,
    tickEpochDurationMs: 60_000,
    heartbeatIntervalSeconds: 60,
    winterActive: false,
    winterStartsAtTick: 30,
    winterEndsAtTick: 80,
    worldPaused: false,
    regions: [{ id: "forest", name: "Forest", ownerClanId: null }],
    clans: [{ id: "1", name: "AClan", treasury: "0x0" }],
    nextHeartbeatAtTick: 1,
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW_SECONDS * 1000);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("newTick === seasonEndTick (LAST tick of season, EXACTLY on boundary): preserves season fields — boundary NOT crossed (strict `>`)", async () => {
    // prevSnap.tick = 359, seasonEndTick = 360, synthetic advance to 360.
    // 360 > 360 is FALSE → preserve. If predicate flipped to `>=`, this fails.
    const snap = {
      ...baseSnap,
      _id: "worldSnapshot:0",
      _creationTime: 1,
      tick: 359,
      seasonStartTick: 0,
      seasonEndTick: 360,
      currentSeasonNumber: 1,
      seasonFinalized: false,
    };
    const { tables, db } = createDb({ worldSnapshot: [snap] });
    await call(advanceTick, db);
    const inserted = tables.worldSnapshot![1];
    expect(inserted.tick).toBe(360);
    expect(inserted.currentSeasonNumber).toBe(1);
    expect(inserted.seasonStartTick).toBe(0);
    expect(inserted.seasonEndTick).toBe(360);
    expect(inserted.seasonFinalized).toBe(false);
  });

  it("newTick === seasonEndTick + 1 (FIRST tick of next season): crosses boundary — fields recompute, seasonFinalized resets", async () => {
    // prevSnap.tick = 360, seasonEndTick = 360, synthetic advance to 361.
    // 361 > 360 is TRUE → cross + recompute via deriveSeasonState(361).
    const snap = {
      ...baseSnap,
      _id: "worldSnapshot:0",
      _creationTime: 1,
      tick: 360,
      seasonStartTick: 0,
      seasonEndTick: 360,
      currentSeasonNumber: 1,
      seasonFinalized: true,
    };
    const { tables, db } = createDb({ worldSnapshot: [snap] });
    await call(advanceTick, db);
    const inserted = tables.worldSnapshot![1];
    expect(inserted.tick).toBe(361);
    // Math.floor(361/360)+1 = 2; seasonStart = 360; seasonEnd = 720
    expect(inserted.currentSeasonNumber).toBe(2);
    expect(inserted.seasonStartTick).toBe(360);
    expect(inserted.seasonEndTick).toBe(720);
    // Critical: new season has not been finalized on chain.
    expect(inserted.seasonFinalized).toBe(false);
  });
});

// =======================================================================
// planPollLogRange — exact range boundaries
// =======================================================================
describe("planPollLogRange — exact range boundaries", () => {
  beforeEach(() => {
    process.env.INDEXER_CONFIRMATION_DEPTH = "5";
  });
  afterEach(() => {
    delete process.env.INDEXER_CONFIRMATION_DEPTH;
    delete process.env.INDEXER_START_BLOCK;
  });

  it("fromBlock === safeLatest (single-block range right at tip): shouldPoll=true, toBlock = safeLatest", () => {
    // lastBlock = 94 → fromBlock = 95. latest = 100, depth = 5 → safeLatest = 95.
    // fromBlock + 9 = 104 > safeLatest(95) → toBlock = safeLatest(95).
    const range = planPollLogRange({ lastBlock: 94 }, 100n);
    expect(range.fromBlock).toBe(95n);
    expect(range.safeLatest).toBe(95n);
    expect(range.toBlock).toBe(95n);
    expect(range.shouldPoll).toBe(true);
  });

  it("fromBlock === safeLatest + 1 (caught up — no new safe block): shouldPoll=false", () => {
    // lastBlock = 95 → fromBlock = 96. latest = 100, depth = 5 → safeLatest = 95.
    // fromBlock(96) > safeLatest(95) → shouldPoll=false; toBlock collapses to safeLatest.
    const range = planPollLogRange({ lastBlock: 95 }, 100n);
    expect(range.fromBlock).toBe(96n);
    expect(range.safeLatest).toBe(95n);
    expect(range.shouldPoll).toBe(false);
  });

  it("latest === depth exactly (boundary where safeLatest = 0): shouldPoll=false for any positive checkpoint", () => {
    // latest = 5, depth = 5 → latest > depth is FALSE → safeLatest = 0n.
    // checkpoint fromBlock(1) > safeLatest(0) → no poll.
    const range = planPollLogRange({ lastBlock: 0 }, 5n);
    expect(range.safeLatest).toBe(0n);
    expect(range.fromBlock).toBe(1n);
    expect(range.shouldPoll).toBe(false);
  });

  it("latest = depth + 1 (one block past depth): safeLatest = 1, shouldPoll=true at fromBlock=1", () => {
    // Off-by-one check: latest(6) > depth(5) → safeLatest = 6 - 5 = 1n.
    const range = planPollLogRange({ lastBlock: 0 }, 6n);
    expect(range.safeLatest).toBe(1n);
    expect(range.fromBlock).toBe(1n);
    expect(range.toBlock).toBe(1n);
    expect(range.shouldPoll).toBe(true);
  });
});

// =======================================================================
// shouldScheduleEventDrivenRefresh — exact equality boundary
// =======================================================================
//
// existing tests in indexer.test.ts cover toBlock>=safeLatest and the
// strict-less backfill cases — pin the EXACT off-by-one toBlock=safeLatest-1
// path to lock in `>=` (vs `>`) semantics.
describe("shouldScheduleEventDrivenRefresh — exact off-by-one", () => {
  it("toBlock === safeLatest - 1 with inserts (one block short of tip): does NOT schedule", () => {
    // Boundary check: predicate uses `>=`, so toBlock=999 vs safeLatest=1000
    // returns false (correct: still backfilling). If flipped to `>`, the
    // earlier `toBlock === safeLatest` case would also return false (wrong),
    // so existing tests + this one together pin the `>=` semantics.
    expect(
      shouldScheduleEventDrivenRefresh({
        inserted: 5,
        toBlock: 999n,
        safeLatest: 1_000n,
      }),
    ).toBe(false);
  });

  it("toBlock === safeLatest with inserted === 1 (smallest positive): schedules", () => {
    // Pin "inserted > 0" vs "inserted >= 0" boundary at the smallest
    // positive value. Combined with the existing zero-inserts test in
    // indexer.test.ts, this rules out off-by-one on both branches.
    expect(
      shouldScheduleEventDrivenRefresh({
        inserted: 1,
        toBlock: 1_000n,
        safeLatest: 1_000n,
      }),
    ).toBe(true);
  });
});

// =======================================================================
// runner.isThematicUidTaken / hasMessageUidReceive — UID_SCAN_LIMIT boundary
// =======================================================================
//
// opus 4.7 flagged the linear 5000-row scan as a boundary hazard. These
// tests exercise the EXACT limit, ZERO rows, and one row PAST the limit
// (UID would be invisible if older than the 5000th newest row). The
// "past-limit" case is the latent-bug surface: a UID that was recorded
// >5000 rows ago will be re-reported as available — a real silent dup
// in heavy traffic, but the current behaviour MUST be locked in until
// the linear scan is replaced with an index lookup.
describe("runner UID scan — exactly at and past UID_SCAN_LIMIT=5000", () => {
  beforeEach(() => {
    vi.stubEnv("BUS_ELDER_SECRET_1", "secret-1");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("zero rows in tickReceiveLog: returns false (no UID match possible)", async () => {
    const { db } = createDb({ tickReceiveLog: [] });
    const taken = await call(isThematicUidTaken, db, {
      elderId: "elder-1",
      secret: "secret-1",
      uid: "any-uid",
    });
    expect(taken).toBe(false);
  });

  it("UID present at exactly the 5000th newest row (oldest visible): still detected", async () => {
    const rows = Array.from({ length: 5000 }, (_, i) => ({
      _id: `tickReceiveLog:${i + 1}`,
      _creationTime: i + 1,
      elderId: "elder-1",
      prefix: "whisper",
      receivedAt: 1,
      messagePreview: "",
      whisperUid: i === 0 ? "target-uid" : `other-${i}`,
    }));
    // i=0 was inserted first → oldest. After order("desc") it's last visible.
    const { db } = createDb({ tickReceiveLog: rows });
    const taken = await call(hasMessageUidReceive, db, {
      elderId: "elder-1",
      secret: "secret-1",
      uid: "target-uid",
    });
    expect(taken).toBe(true);
  });

  it("UID present only in the 5001st newest row (just past scan window): MISSED — latent silent-dup hazard documented", async () => {
    // 5001 total rows; the OLDEST one (creationTime=1) holds the target UID.
    // order("desc").take(5000) returns the 5000 newest → the oldest is dropped.
    // The function returns false even though the UID was recorded. This
    // mirrors production behaviour and is the LATENT BUG opus 4.7 flagged.
    // Test locks current behaviour so any switch to an index-backed lookup
    // (the right fix) will fail loudly + force review.
    const rows = Array.from({ length: 5001 }, (_, i) => ({
      _id: `tickReceiveLog:${i + 1}`,
      _creationTime: i + 1,
      elderId: "elder-1",
      prefix: "whisper",
      receivedAt: 1,
      messagePreview: "",
      whisperUid: i === 0 ? "target-uid" : `other-${i}`,
    }));
    const { db } = createDb({ tickReceiveLog: rows });
    const taken = await call(isThematicUidTaken, db, {
      elderId: "elder-1",
      secret: "secret-1",
      uid: "target-uid",
    });
    // Documented limitation: linear-scan window means oldest UIDs are
    // invisible past 5000 rows. Re-using "target-uid" would create a dup.
    expect(taken).toBe(false);
  });

  it("UID matches specialMsgUid (not whisperUid) at row 5000 boundary: detected via OR branch", async () => {
    // The .some() callback OR-s both fields — verify the second branch fires
    // exactly at the boundary row.
    const rows = Array.from({ length: 5000 }, (_, i) => ({
      _id: `tickReceiveLog:${i + 1}`,
      _creationTime: i + 1,
      elderId: "elder-1",
      prefix: "special-msg",
      receivedAt: 1,
      messagePreview: "",
      specialMsgUid: i === 4999 ? "target-uid" : `other-${i}`, // newest row
    }));
    const { db } = createDb({ tickReceiveLog: rows });
    const taken = await call(isThematicUidTaken, db, {
      elderId: "elder-1",
      secret: "secret-1",
      uid: "target-uid",
    });
    expect(taken).toBe(true);
  });
});

// =======================================================================
// runner.getRunnerStartupState — empty-table edges
// =======================================================================
describe("runner.getRunnerStartupState — empty table fallback edges", () => {
  beforeEach(() => {
    vi.stubEnv("BUS_ELDER_SECRET_1", "secret-1");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("empty tickClock + empty tickReceiveLog + empty tickSendLog: synthesizes tick=0 clock and reports lastReceivedTick=null", async () => {
    // Boundary: every singleton table is empty. latestClock() returns the
    // synthetic fallback (tick=0). lastReceivedTick must be null, not 0.
    // sentForCurrentTick must be false. Pinning this distinguishes
    // "never received" from "received tick 0" — a class of bug that
    // caused the late_join reset loop the by_elder_tick index fix addressed.
    const { db } = createDb({});
    const result = await call(getRunnerStartupState, db, {
      elderId: "elder-1",
      secret: "secret-1",
    });
    expect(result.tickClock.tick).toBe(0);
    expect(result.lastReceivedTick).toBeNull();
    expect(result.sentForCurrentTick).toBe(false);
  });

  it("elder has 1 whisper (tickNumber=undefined) but ZERO tick rows: returns null — whisper rows must not displace", async () => {
    // by_elder_tick index sort-edge: Convex sorts undefined FIRST in asc,
    // so a desc query returns the highest defined tickNumber first.
    // Whisper rows (tickNumber=undefined) must sort to the tail.
    // If a later refactor broke this ordering, the elder would see
    // lastReceivedTick=null while a whisper row was present.
    const tickReceiveLog = [
      {
        _id: "tickReceiveLog:1",
        _creationTime: 1,
        elderId: "elder-1",
        prefix: "whisper",
        receivedAt: 1,
        messagePreview: "",
        whisperUid: "w-1",
        // tickNumber intentionally absent.
      },
    ];
    const { db } = createDb({ tickReceiveLog });
    const result = await call(getRunnerStartupState, db, {
      elderId: "elder-1",
      secret: "secret-1",
    });
    expect(result.lastReceivedTick).toBeNull();
  });
});
