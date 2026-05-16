/**
 * Tests for the split chainEvents queries introduced in issue #336.
 *
 * Uses a hand-rolled in-memory `createDb` mock (consistent with
 * `retention.test.ts`) so we don't pull in `convex-test` for a 2-query module.
 *
 * Covers:
 *   - `getEventTickerFeed`: limit clamping (1..30), default 10, ordering.
 *   - `getBattleEvents`: tickWindow clamping (1..20), event-name filtering,
 *     fallback when tickClock is empty, hard cap.
 *   - `getRecentChainEvents`: back-compat wrapper still returns last 60.
 */

import { describe, expect, it } from "vitest";
import {
  BATTLE_EVENT_FETCH_HARD_CAP,
  BATTLE_EVENT_NAMES,
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
          return builder;
        },
        order(direction: "asc" | "desc") {
          // For by_tick index, order by tick; else by _creationTime.
          const sortField = usedIndex === "by_tick" ? "tick" : "_creationTime";
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
      };
      return builder;
    },
  };

  return { tables, db };
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
    const events = Array.from({ length: 20 }, (_, i) =>
      evt("MissionAssigned", 5),
    );
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
        // OUT of window (too old)
        evt("BanditAttackResolved", 5),
        // IN window, non-battle — should be filtered out
        evt("MissionAssigned", 8),
        evt("ResourcesGathered", 9),
        evt("WorkerArrived", 10),
        // IN window, battle events — should be returned
        evt("BanditAttackResolved", 9),
        evt("WallDamagedByBandit", 10),
        evt("LootDistributed", 10),
        evt("BanditDefeated", 10),
      ],
    });

    const result = await callHandler<{ tickWindow?: number }, Row[]>(
      getBattleEvents,
      { db },
      { tickWindow: 3 },
    );

    expect(result).toHaveLength(4);
    const names = result.map((r) => r.eventName).sort();
    expect(names).toEqual(
      [
        "BanditAttackResolved",
        "BanditDefeated",
        "LootDistributed",
        "WallDamagedByBandit",
      ].sort(),
    );
  });

  it("excludes a `BanditAttackResolved` older than the tick window", async () => {
    const { db } = createDb({
      tickClock: [clock(20)],
      chainEvents: [
        evt("BanditAttackResolved", 5), // 15 ticks old → out
        evt("BanditAttackResolved", 18), // 2 ticks old → in
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

  it("defaults tickWindow to 3 when not specified", async () => {
    const { db } = createDb({
      tickClock: [clock(10)],
      chainEvents: [
        evt("BanditAttackResolved", 6), // 4 ticks old → out at default=3
        evt("BanditAttackResolved", 7), // 3 ticks old → in (gte 10-3=7)
        evt("BanditAttackResolved", 10),
      ],
    });

    const result = await callHandler<{ tickWindow?: number }, Row[]>(
      getBattleEvents,
      { db },
      {},
    );
    expect(result.map((r) => r.tick as number).sort((a, b) => a - b)).toEqual([7, 10]);
  });

  it("clamps tickWindow > 20 down to 20", async () => {
    const { db } = createDb({
      tickClock: [clock(100)],
      chainEvents: [
        evt("BanditAttackResolved", 50), // 50 old → out even after clamp
        evt("BanditAttackResolved", 80), // 20 old → boundary (gte 80)
        evt("BanditAttackResolved", 100),
      ],
    });

    const result = await callHandler<{ tickWindow?: number }, Row[]>(
      getBattleEvents,
      { db },
      { tickWindow: 1000 },
    );
    expect(result.map((r) => r.tick as number).sort((a, b) => a - b)).toEqual([80, 100]);
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
    // tickWindow=1 → minTick = 9, so ticks 9 and 10 included
    expect(result.map((r) => r.tick as number).sort((a, b) => a - b)).toEqual([9, 10]);
  });

  it("falls back to scanning recent chainEvents when tickClock is empty", async () => {
    const { db } = createDb({
      tickClock: [],
      chainEvents: [
        evt("BanditAttackResolved", undefined),
        evt("MissionAssigned", undefined),
        evt("LootDistributed", undefined),
      ],
    });

    const result = await callHandler<{ tickWindow?: number }, Row[]>(
      getBattleEvents,
      { db },
      {},
    );

    // Should still filter out non-battle events even in fallback mode.
    expect(result.map((r) => r.eventName).sort()).toEqual(
      ["BanditAttackResolved", "LootDistributed"].sort(),
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
  });
});

// ─────────────────────────────────────────────────────────────────────────
// getRecentChainEvents (back-compat wrapper)
// ─────────────────────────────────────────────────────────────────────────

describe("getRecentChainEvents (back-compat)", () => {
  it("still returns the last 60 events for one-release back-compat", async () => {
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
  });
});
