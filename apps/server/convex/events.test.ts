/**
 * Tests for the split chainEvents queries introduced in issue #336.
 *
 * Uses a hand-rolled in-memory `createDb` mock (consistent with
 * `retention.test.ts`) so we don't pull in `convex-test` for a 2-query module.
 *
 * Covers:
 *   - `getEventTickerFeed`: limit clamping (1..30), default 10, ordering.
 *   - `getBattleEvents`: tickWindow clamping (1..20), event-name filtering,
 *     fallback when tickClock is empty, hard cap, cap-before-filter hazard
 *     (issue #336 MUST-fix-1), and dead-letter exclusion for events
 *     without a tick arg at the contract level (issue #336 MUST-fix-2).
 *   - `getRecentChainEvents`: back-compat wrapper still returns last 60 with
 *     correct ordering (issue #336 SHOULD-fix-2).
 */

import { describe, expect, it } from "vitest";
import {
  BATTLE_EVENT_FETCH_HARD_CAP,
  BATTLE_EVENT_NAMES,
  BATTLE_EVENT_PER_NAME_TAKE,
  getBattleEvents,
  getEventTickerFeed,
  getRecentChainEvents,
} from "./events";

// ─────────────────────────────────────────────────────────────────────────
// Mock Convex DB — minimal subset required by events.ts
// ─────────────────────────────────────────────────────────────────────────

interface Row {
  _id: string;
  _creationTime: number;
  [k: string]: unknown;
}

type Clause =
  | { op: "eq"; field: string; value: unknown }
  | { op: "gte"; field: string; value: number };

function applyClauses(rows: Row[], clauses: Clause[]): Row[] {
  return rows.filter((row) =>
    clauses.every((c) => {
      const v = row[c.field];
      if (c.op === "eq") return v === c.value;
      // gte mirrors Convex semantics: rows with undefined for the index key
      // are excluded from the scan. This matters for tick-less battle-shaped
      // events whose indexed tick column is undefined (see indexer.ts:532).
      if (c.op === "gte") return typeof v === "number" && v >= c.value;
      return false;
    }),
  );
}

function createDb(initial: Record<string, Row[]> = {}) {
  const tables: Record<string, Row[]> = {};
  for (const [name, rows] of Object.entries(initial)) {
    tables[name] = rows.map((r) => ({ ...r }));
  }

  const db = {
    query(table: string) {
      let rows = [...(tables[table] ?? [])];
      let usedIndex: string | null = null;
      const builder = {
        withIndex(name: string, apply?: (q: any) => unknown) {
          usedIndex = name;
          const clauses: Clause[] = [];
          if (apply) {
            const q = {
              eq(field: string, value: unknown) {
                clauses.push({ op: "eq", field, value });
                return q;
              },
              gte(field: string, value: number) {
                clauses.push({ op: "gte", field, value });
                return q;
              },
            };
            apply(q);
          }
          rows = applyClauses(rows, clauses);
          // For by_event_tick / by_tick, Convex would not surface undefined-
          // tick rows even without an explicit gte (the row simply isn't in
          // the index). Mirror that: any tick-scoped index drops rows with
          // undefined tick from the eligible set.
          if (usedIndex === "by_tick" || usedIndex === "by_event_tick") {
            rows = rows.filter((r) => typeof r.tick === "number");
          }
          return builder;
        },
        order(direction: "asc" | "desc") {
          // tick-indexed scans order by tick; everything else by _creationTime.
          const sortField =
            usedIndex === "by_tick" || usedIndex === "by_event_tick"
              ? "tick"
              : "_creationTime";
          rows = [...rows].sort((a, b) => {
            const av = (a[sortField] as number | undefined) ?? 0;
            const bv = (b[sortField] as number | undefined) ?? 0;
            return direction === "desc" ? bv - av : av - bv;
          });
          return builder;
        },
        async first(): Promise<Row | null> {
          return rows[0] ?? null;
        },
        async take(n: number): Promise<Row[]> {
          return rows.slice(0, n);
        },
        async collect(): Promise<Row[]> {
          return [...rows];
        },
      };
      return builder;
    },
  };

  return { tables, db };
}

// Tiny helper to narrow an `unknown` field to `number`. We use this instead
// of `as number` casts so a fixture regression (tick accidentally undefined)
// fails the test instead of silently coercing through the type system.
function asNumber(value: unknown, label: string): number {
  if (typeof value !== "number") {
    throw new Error(`expected ${label} to be a number, got ${typeof value}`);
  }
  return value;
}

// Tiny helper to invoke a Convex query's handler against our mock ctx.
// The generated `query({ handler })` shape exposes the handler in
// non-type-safe ways at runtime; we hit `_handler` if present, falling back
// to `handler`. The retention tests use the same pattern.
function callHandler<TArgs, TResult>(
  q: unknown,
  ctx: { db: unknown },
  args: TArgs,
): Promise<TResult> {
  const h =
    (q as { _handler?: (ctx: any, args: any) => Promise<TResult> })._handler ??
    (q as { handler?: (ctx: any, args: any) => Promise<TResult> }).handler;
  if (!h) throw new Error("query has no callable handler");
  return h(ctx, args);
}

// ─────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────

let idCounter = 0;
function evt(
  eventName: string,
  tick: number | undefined,
  extra: Partial<Row> = {},
): Row {
  idCounter++;
  return {
    _id: `chainEvents:${idCounter}`,
    _creationTime: idCounter,
    eventName,
    blockNumber: 1000 + idCounter,
    logIndex: idCounter,
    txHash: `0x${idCounter.toString().padStart(64, "0")}`,
    tick,
    args: {},
    decodedAt: idCounter,
    ...extra,
  };
}

function clock(tick: number): Row {
  return {
    _id: "tickClock:1",
    _creationTime: 1,
    tick,
    blockNumber: 1000 + tick,
    tickEpochStartedAt: 0,
    tickEpochDurationMs: 1000,
    seasonStartTick: 0,
    seasonEndTick: 1000,
    winterActive: false,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// getEventTickerFeed
// ─────────────────────────────────────────────────────────────────────────

describe("getEventTickerFeed", () => {
  it("defaults to 10 events ordered desc by _creationTime", async () => {
    const events = Array.from({ length: 20 }, () => evt("MissionAssigned", 5));
    const { db } = createDb({ chainEvents: events });

    const result = await callHandler<{ limit?: number }, Row[]>(
      getEventTickerFeed,
      { db },
      {},
    );

    expect(result).toHaveLength(10);
    // newest first
    const ids = result.map((r) => r._creationTime);
    const sorted = [...ids].sort((a, b) => b - a);
    expect(ids).toEqual(sorted);
  });

  it("honors a custom limit within the 1..30 band", async () => {
    const events = Array.from({ length: 40 }, () => evt("WorkerArrived", 1));
    const { db } = createDb({ chainEvents: events });

    const result = await callHandler<{ limit?: number }, Row[]>(
      getEventTickerFeed,
      { db },
      { limit: 5 },
    );
    expect(result).toHaveLength(5);
  });

  it("clamps limit > 30 down to 30 (guards against payload regression)", async () => {
    const events = Array.from({ length: 100 }, () => evt("WorkerArrived", 1));
    const { db } = createDb({ chainEvents: events });

    const result = await callHandler<{ limit?: number }, Row[]>(
      getEventTickerFeed,
      { db },
      { limit: 1000 },
    );
    expect(result).toHaveLength(30);
  });

  it("clamps limit < 1 up to 1", async () => {
    const events = Array.from({ length: 10 }, () => evt("WorkerArrived", 1));
    const { db } = createDb({ chainEvents: events });

    const result = await callHandler<{ limit?: number }, Row[]>(
      getEventTickerFeed,
      { db },
      { limit: 0 },
    );
    expect(result).toHaveLength(1);
  });

  it("returns [] for an empty chainEvents table", async () => {
    const { db } = createDb({ chainEvents: [] });
    const result = await callHandler<{ limit?: number }, Row[]>(
      getEventTickerFeed,
      { db },
      {},
    );
    expect(result).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// getBattleEvents
// ─────────────────────────────────────────────────────────────────────────

describe("getBattleEvents", () => {
  it("returns only battle-cluster event names within the tick window", async () => {
    const { db } = createDb({
      tickClock: [clock(10)],
      chainEvents: [
        // OUT of window (too old at tickWindow=3 → minTick=8)
        evt("BanditAttackResolved", 5),
        // IN window, non-battle — should be filtered out (and never even
        // surface via the by_event_tick eq filter).
        evt("MissionAssigned", 8),
        evt("ResourcesGathered", 9),
        evt("WorkerArrived", 10),
        // IN window, battle events from the trimmed-list — should be returned
        evt("BanditAttackResolved", 9),
        evt("BanditDefeated", 10),
        evt("BanditTargetDied", 10),
        evt("BanditEscaped", 9),
        evt("BanditStateChanged", 8),
        evt("BlueprintEarned", 10),
      ],
    });

    const result = await callHandler<{ tickWindow?: number }, Row[]>(
      getBattleEvents,
      { db },
      { tickWindow: 3 },
    );

    expect(result).toHaveLength(6);
    const names = result.map((r) => r.eventName).sort();
    expect(names).toEqual(
      [
        "BanditAttackResolved",
        "BanditDefeated",
        "BanditEscaped",
        "BanditStateChanged",
        "BanditTargetDied",
        "BlueprintEarned",
      ].sort(),
    );
  });

  it("excludes a `BanditAttackResolved` older than the tick window", async () => {
    const { db } = createDb({
      tickClock: [clock(20)],
      chainEvents: [
        // tickWindow=3 at tick=20 → minTick=18, so tick=17 is out.
        evt("BanditAttackResolved", 17),
        evt("BanditAttackResolved", 18),
      ],
    });

    const result = await callHandler<{ tickWindow?: number }, Row[]>(
      getBattleEvents,
      { db },
      { tickWindow: 3 },
    );

    expect(result).toHaveLength(1);
    expect(result[0]!.tick).toBe(18);
  });

  it("tickWindow=3 includes exactly 3 ticks (issue #336 SHOULD-fix-1)", async () => {
    // With current tick=10 and tickWindow=3, the contract says the window
    // covers ticks 8, 9, 10 — three ticks inclusive of the current one.
    // The pre-fix implementation included 4 (ticks 7..10).
    const { db } = createDb({
      tickClock: [clock(10)],
      chainEvents: [
        evt("BanditAttackResolved", 7), // OUT (4th tick back)
        evt("BanditAttackResolved", 8), // IN  (3rd tick back)
        evt("BanditAttackResolved", 9), // IN  (2nd tick back)
        evt("BanditAttackResolved", 10), // IN (current)
      ],
    });
    const result = await callHandler<{ tickWindow?: number }, Row[]>(
      getBattleEvents,
      { db },
      { tickWindow: 3 },
    );
    expect(result.map((r) => asNumber(r.tick, "r.tick")).sort((a, b) => a - b)).toEqual([
      8, 9, 10,
    ]);
  });

  it("defaults tickWindow to 3 when not specified", async () => {
    const { db } = createDb({
      tickClock: [clock(10)],
      chainEvents: [
        evt("BanditAttackResolved", 7), // 4 ticks back → OUT at default=3
        evt("BanditAttackResolved", 8), // 3 ticks back → IN  (minTick=8)
        evt("BanditAttackResolved", 10),
      ],
    });

    const result = await callHandler<{ tickWindow?: number }, Row[]>(
      getBattleEvents,
      { db },
      {},
    );
    expect(result.map((r) => asNumber(r.tick, "r.tick")).sort((a, b) => a - b)).toEqual([
      8, 10,
    ]);
  });

  it("clamps tickWindow > 20 down to 20", async () => {
    const { db } = createDb({
      tickClock: [clock(100)],
      chainEvents: [
        evt("BanditAttackResolved", 50), // 50 old → OUT after clamp
        evt("BanditAttackResolved", 81), // 19 old → IN  (minTick=100-20+1=81)
        evt("BanditAttackResolved", 100),
      ],
    });

    const result = await callHandler<{ tickWindow?: number }, Row[]>(
      getBattleEvents,
      { db },
      { tickWindow: 1000 },
    );
    expect(result.map((r) => asNumber(r.tick, "r.tick")).sort((a, b) => a - b)).toEqual([
      81, 100,
    ]);
  });

  it("clamps tickWindow < 1 up to 1", async () => {
    const { db } = createDb({
      tickClock: [clock(10)],
      chainEvents: [
        evt("BanditAttackResolved", 8),
        evt("BanditAttackResolved", 9),
        evt("BanditAttackResolved", 10),
      ],
    });

    const result = await callHandler<{ tickWindow?: number }, Row[]>(
      getBattleEvents,
      { db },
      { tickWindow: 0 },
    );
    // tickWindow=1 → minTick = 10, only the current tick included.
    expect(result.map((r) => asNumber(r.tick, "r.tick")).sort((a, b) => a - b)).toEqual([
      10,
    ]);
  });

  it("falls back to scanning recent chainEvents when tickClock is empty", async () => {
    const { db } = createDb({
      tickClock: [],
      chainEvents: [
        evt("BanditAttackResolved", 5),
        evt("MissionAssigned", 5),
        evt("BanditDefeated", 6),
      ],
    });

    const result = await callHandler<{ tickWindow?: number }, Row[]>(
      getBattleEvents,
      { db },
      {},
    );

    // Should still filter out non-battle events even in fallback mode.
    expect(result.map((r) => r.eventName).sort()).toEqual(
      ["BanditAttackResolved", "BanditDefeated"].sort(),
    );
  });

  it("returns [] when no battle events fall in the tick window", async () => {
    const { db } = createDb({
      tickClock: [clock(10)],
      chainEvents: [
        evt("MissionAssigned", 10),
        evt("ResourcesGathered", 10),
        evt("WorkerArrived", 10),
      ],
    });

    const result = await callHandler<{ tickWindow?: number }, Row[]>(
      getBattleEvents,
      { db },
      {},
    );
    expect(result).toEqual([]);
  });

  it("BATTLE_EVENT_NAMES includes the event WorldMap depends on (BanditAttackResolved)", () => {
    // Regression guard against accidentally dropping the event that drives
    // the combat vignette.
    expect(BATTLE_EVENT_NAMES).toContain("BanditAttackResolved");
  });

  it("hard cap is sane (>= default tick-window worth of events)", () => {
    expect(BATTLE_EVENT_FETCH_HARD_CAP).toBeGreaterThanOrEqual(20);
    expect(BATTLE_EVENT_PER_NAME_TAKE).toBeGreaterThanOrEqual(1);
  });

  // ──────────────────── issue #336 regression tests ────────────────────────

  it("returns battle event even when 60+ non-battle events precede it in the window (MUST-fix-1)", async () => {
    // Repro of the cap-before-filter hazard: the pre-fix implementation
    // did `take(BATTLE_EVENT_FETCH_HARD_CAP=50)` BEFORE filtering by event
    // name. A burst of >50 non-battle events at a recent tick would evict
    // the battle event from the scan window. The fix routes through a
    // per-event-name index, so the battle event surfaces regardless of
    // how many non-battle events share the window.
    const noise = Array.from({ length: 60 }, () =>
      evt("ResourcesGathered", 10),
    );
    const { db } = createDb({
      tickClock: [clock(10)],
      chainEvents: [
        ...noise,
        // The buried battle event — earlier tick, fewer log indexes than the
        // noise pile-up, but still within the default 3-tick window.
        evt("BanditAttackResolved", 9),
      ],
    });

    const result = await callHandler<{ tickWindow?: number }, Row[]>(
      getBattleEvents,
      { db },
      { tickWindow: 3 },
    );

    expect(result).toHaveLength(1);
    expect(result[0]!.eventName).toBe("BanditAttackResolved");
    expect(result[0]!.tick).toBe(9);
  });

  it("does NOT return LootDistributed events — no tick arg means dead in by_tick scan (MUST-fix-2)", async () => {
    // The contract event `LootDistributed` has no tick / atTick / openedTick
    // arg, so the indexer writes `tick: undefined`. Convex's tick-indexed
    // scans don't surface rows with undefined index keys, so listing
    // LootDistributed in BATTLE_EVENT_NAMES would just produce dead letters
    // for any consumer expecting it. This guards against a future refactor
    // re-adding it (or one of its tick-less siblings) to the list.
    const { db } = createDb({
      tickClock: [clock(10)],
      chainEvents: [
        // Dead-letter shape: events without a tick arg get `tick: undefined`
        // from the real indexer (apps/server/convex/indexer.ts:532-535).
        evt("LootDistributed", undefined),
        evt("WallDamagedByBandit", undefined),
        evt("ClansmanKilledByBandit", undefined),
        evt("BlueprintAwarded", undefined),
        evt("LootDistributedToDefender", undefined),
        // Sanity: a real battle event still surfaces.
        evt("BanditAttackResolved", 10),
      ],
    });
    const result = await callHandler<{ tickWindow?: number }, Row[]>(
      getBattleEvents,
      { db },
      { tickWindow: 3 },
    );
    const names = result.map((r) => r.eventName);
    expect(names).not.toContain("LootDistributed");
    expect(names).not.toContain("WallDamagedByBandit");
    expect(names).not.toContain("ClansmanKilledByBandit");
    expect(names).not.toContain("BlueprintAwarded");
    expect(names).not.toContain("LootDistributedToDefender");
    expect(names).toContain("BanditAttackResolved");
  });

  it("BATTLE_EVENT_NAMES is trimmed to events with a contract-level tick arg", () => {
    // Cross-check against IClanWorld.sol so a future event addition that
    // forgets a tick arg can't silently re-introduce dead letters.
    const TICKLESS_BATTLE_SHAPED_EVENTS = [
      "WallDamagedByBandit",
      "ClansmanKilledByBandit",
      "BlueprintAwarded",
      "LootDistributed",
      "LootDistributedToDefender",
    ];
    for (const name of TICKLESS_BATTLE_SHAPED_EVENTS) {
      expect(BATTLE_EVENT_NAMES).not.toContain(name);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────
// getRecentChainEvents (back-compat wrapper)
// ─────────────────────────────────────────────────────────────────────────

describe("getRecentChainEvents (back-compat)", () => {
  it("returns the last 60 events newest-first (issue #336 SHOULD-fix-2)", async () => {
    const events = Array.from({ length: 100 }, () =>
      evt("MissionAssigned", 1),
    );
    const { db } = createDb({ chainEvents: events });

    const result = await callHandler<Record<string, never>, Row[]>(
      getRecentChainEvents,
      { db },
      {},
    );

    expect(result).toHaveLength(60);
    // Ordering: newest first by _creationTime (the default-table-scan order
    // the wrapper relies on). The previous test only checked length, which
    // would have passed even if the wrapper accidentally returned the
    // OLDEST 60 — a real regression for ticker consumers still on the
    // back-compat path.
    const creationTimes = result.map((r) => r._creationTime as number);
    const sortedDesc = [...creationTimes].sort((a, b) => b - a);
    expect(creationTimes).toEqual(sortedDesc);
    // The highest creation time across the 100-event fixture should be
    // included; the lowest should NOT (it would be the 60-event window
    // furthest from the tail).
    const allCreationTimes = events.map((e) => e._creationTime);
    const maxCreation = Math.max(...allCreationTimes);
    const minCreation = Math.min(...allCreationTimes);
    expect(creationTimes).toContain(maxCreation);
    expect(creationTimes).not.toContain(minCreation);
  });
});
