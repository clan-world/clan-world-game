/**
 * Tests for retention purge logic (issue #337).
 *
 * Strategy: build a richer in-memory `createDb` mock than the one in
 * `indexer.test.ts` because purge needs `.lt`, `.take`, `.delete`, and
 * the implicit `by_creation_time` index. The mock is hand-rolled (not
 * `convex-test`) to stay consistent with the rest of `apps/server/convex/`.
 *
 * Each scenario:
 *   1. Seed the mock DB with a mix of "old" (pre-cutoff) and "new"
 *      (post-cutoff) rows.
 *   2. Invoke either the public `purgeStaleData._handler(ctx)` or one of
 *      the exported helpers.
 *   3. Assert which rows survived.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  purgeGroupedPreserveLatest,
  purgeStaleData,
  purgeTimeWindowTable,
} from "./retention";
import { RETENTION_HOURS } from "./retention.config";

// ─────────────────────────────────────────────────────────────────────────
// Mock Convex DB
// ─────────────────────────────────────────────────────────────────────────

interface Row {
  _id: string;
  _creationTime: number;
  [k: string]: unknown;
}

type Clause =
  | { op: "eq"; field: string; value: unknown }
  | { op: "lt"; field: string; value: number }
  | { op: "gt"; field: string; value: number };

function applyClauses(rows: Row[], clauses: Clause[]): Row[] {
  return rows.filter((row) =>
    clauses.every((c) => {
      const v = row[c.field];
      if (c.op === "eq") return v === c.value;
      if (c.op === "lt") return typeof v === "number" && v < c.value;
      if (c.op === "gt") return typeof v === "number" && v > c.value;
      return false;
    }),
  );
}

function createDb(initial: Record<string, Row[]> = {}) {
  const tables: Record<string, Row[]> = {};
  for (const [name, rows] of Object.entries(initial)) {
    tables[name] = rows.map((r) => ({ ...r }));
  }

  let creationCounter = 0;
  const nextCreationTime = () => ++creationCounter;
  // Bump counter past any seeded `_creationTime` so future inserts don't
  // collide with seeded values.
  for (const rows of Object.values(tables)) {
    for (const r of rows) {
      if (r._creationTime > creationCounter) creationCounter = r._creationTime;
    }
  }

  const db = {
    async insert(table: string, value: Record<string, unknown>) {
      tables[table] ??= [];
      const doc: Row = {
        ...value,
        _id: `${table}:${tables[table].length}`,
        _creationTime:
          typeof value._creationTime === "number"
            ? (value._creationTime as number)
            : nextCreationTime(),
      };
      tables[table].push(doc);
      return doc._id;
    },
    async delete(id: string) {
      for (const rows of Object.values(tables)) {
        const idx = rows.findIndex((row) => row._id === id);
        if (idx >= 0) {
          rows.splice(idx, 1);
          return;
        }
      }
    },
    async get(id: string): Promise<Row | null> {
      for (const rows of Object.values(tables)) {
        const found = rows.find((row) => row._id === id);
        if (found) return found;
      }
      return null;
    },
    query(table: string) {
      let rows = [...(tables[table] ?? [])];
      const builder = {
        withIndex(_name: string, apply?: (q: any) => unknown) {
          const clauses: Clause[] = [];
          if (apply) {
            const q = {
              eq(field: string, value: unknown) {
                clauses.push({ op: "eq", field, value });
                return q;
              },
              lt(field: string, value: number) {
                clauses.push({ op: "lt", field, value });
                return q;
              },
              gt(field: string, value: number) {
                clauses.push({ op: "gt", field, value });
                return q;
              },
            };
            apply(q);
          }
          rows = applyClauses(rows, clauses);
          return builder;
        },
        order(direction: "asc" | "desc") {
          rows = [...rows].sort((a, b) =>
            direction === "desc"
              ? b._creationTime - a._creationTime
              : a._creationTime - b._creationTime,
          );
          return builder;
        },
        async first(): Promise<Row | null> {
          return rows[0] ?? null;
        },
        async take(n: number): Promise<Row[]> {
          return rows.slice(0, n);
        },
        async collect(): Promise<Row[]> {
          return rows.slice();
        },
      };
      return builder;
    },
  };

  return { tables, db };
}

// ─────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────

const NOW = 1_700_000_000_000; // arbitrary fixed "now" in ms
const HOUR_MS = 60 * 60 * 1000;
const CUTOFF = NOW - RETENTION_HOURS * HOUR_MS;

const old = (offsetHours: number) => CUTOFF - offsetHours * HOUR_MS;
const fresh = (offsetHours: number) => CUTOFF + offsetHours * HOUR_MS;

function rows(table: string, creationTimes: number[], extra: (i: number) => Record<string, unknown> = () => ({})): Row[] {
  return creationTimes.map((t, i) => ({
    _id: `${table}:seed-${i}`,
    _creationTime: t,
    ...extra(i),
  }));
}

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

// ─────────────────────────────────────────────────────────────────────────
// purgeTimeWindowTable — pure age-based delete
// ─────────────────────────────────────────────────────────────────────────

describe("purgeTimeWindowTable", () => {
  it("deletes rows older than cutoff and leaves fresh rows", async () => {
    const { db, tables } = createDb({
      chainEvents: [
        ...rows("chainEvents", [old(10), old(5), old(1)]),
        ...rows("chainEvents", [fresh(1), fresh(5), fresh(10), fresh(20)]),
      ],
    });

    const result = await purgeTimeWindowTable(
      { db } as any,
      "chainEvents",
      CUTOFF,
    );

    expect(result.deleted).toBe(3);
    expect(result.truncated).toBe(false);
    expect(tables.chainEvents).toHaveLength(4);
    expect(tables.chainEvents!.every((r) => r._creationTime >= CUTOFF)).toBe(
      true,
    );
  });

  it("is a no-op when no rows are older than cutoff", async () => {
    const { db, tables } = createDb({
      agentLogs: rows("agentLogs", [fresh(0), fresh(1), fresh(10)]),
    });

    const result = await purgeTimeWindowTable(
      { db } as any,
      "agentLogs",
      CUTOFF,
    );

    expect(result.deleted).toBe(0);
    expect(result.truncated).toBe(false);
    expect(tables.agentLogs).toHaveLength(3);
  });

  it("is a no-op on an empty table", async () => {
    const { db } = createDb();
    const result = await purgeTimeWindowTable(
      { db } as any,
      "whispers",
      CUTOFF,
    );
    expect(result.deleted).toBe(0);
    expect(result.truncated).toBe(false);
  });

  it("truncates and reports truncated=true when stale rows exceed PURGE_BATCH_SIZE", async () => {
    // Seed PURGE_BATCH_SIZE + 5 old rows. After one run, exactly
    // PURGE_BATCH_SIZE should be deleted and truncated=true. (We don't
    // actually want to wait for a second cron run in the test — just
    // verify the flag is set.)
    const { PURGE_BATCH_SIZE } = await import("./retention.config");
    const oldCreationTimes = Array.from(
      { length: PURGE_BATCH_SIZE + 5 },
      (_, i) => old(20 + i / 100),
    );
    const { db, tables } = createDb({
      chainEvents: rows("chainEvents", oldCreationTimes),
    });

    const result = await purgeTimeWindowTable(
      { db } as any,
      "chainEvents",
      CUTOFF,
    );

    expect(result.deleted).toBe(PURGE_BATCH_SIZE);
    expect(result.truncated).toBe(true);
    expect(tables.chainEvents).toHaveLength(5);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// purgeGroupedPreserveLatest — keep latest-per-group
// ─────────────────────────────────────────────────────────────────────────

describe("purgeGroupedPreserveLatest", () => {
  it("clanView: when every clan has fresh rows, ALL old rows are deleted", async () => {
    // 3 clans × 3 old each = 9 olds; each clan also has 2 fresh.
    // For every old row, latestFor(clanId) === a fresh row → all olds
    // deleted. Survivors: 3 clans × 2 fresh = 6.
    const seedRows: Row[] = [];
    let idCounter = 0;
    for (const clanId of [1, 2, 3]) {
      for (const ct of [old(20), old(15), old(10)]) {
        seedRows.push({
          _id: `clanView:seed-${idCounter++}`,
          _creationTime: ct,
          clanId,
        });
      }
      for (const ct of [fresh(1), fresh(5)]) {
        seedRows.push({
          _id: `clanView:seed-${idCounter++}`,
          _creationTime: ct,
          clanId,
        });
      }
    }
    const { db, tables } = createDb({ clanView: seedRows });

    const result = await purgeGroupedPreserveLatest({ db } as any, {
      table: "clanView",
      cutoff: CUTOFF,
      indexName: "by_clanId",
      indexField: "clanId",
      groupKeyOf: (row) => row.clanId,
    });

    expect(result.deleted).toBe(9);
    expect(tables.clanView).toHaveLength(6);
    expect(tables.clanView!.every((r) => r._creationTime >= CUTOFF)).toBe(true);
    for (const clanId of [1, 2, 3]) {
      expect(tables.clanView!.filter((r) => r.clanId === clanId)).toHaveLength(
        2,
      );
    }
  });

  it("clanView: clan with only old rows keeps its single latest row", async () => {
    // Clan 1: 3 old, no fresh → latest old must survive.
    // Clan 2: 3 fresh → all survive.
    const seed: Row[] = [
      { _id: "clanView:0", _creationTime: old(20), clanId: 1 },
      { _id: "clanView:1", _creationTime: old(15), clanId: 1 },
      { _id: "clanView:2", _creationTime: old(10), clanId: 1 }, // latest for clan 1
      { _id: "clanView:3", _creationTime: fresh(1), clanId: 2 },
      { _id: "clanView:4", _creationTime: fresh(5), clanId: 2 },
      { _id: "clanView:5", _creationTime: fresh(10), clanId: 2 }, // latest for clan 2
    ];
    const { db, tables } = createDb({ clanView: seed });

    await purgeGroupedPreserveLatest({ db } as any, {
      table: "clanView",
      cutoff: CUTOFF,
      indexName: "by_clanId",
      indexField: "clanId",
      groupKeyOf: (row) => row.clanId,
    });

    // Clan 1: only the latest old (clanView:2) survives.
    const clan1 = tables.clanView!.filter((r) => r.clanId === 1);
    expect(clan1).toHaveLength(1);
    expect(clan1[0]!._id).toBe("clanView:2");

    // Clan 2: all 3 fresh rows survive.
    const clan2 = tables.clanView!.filter((r) => r.clanId === 2);
    expect(clan2).toHaveLength(3);
  });

  it("clanView: with both old and fresh, only fresh survive (latest is fresh)", async () => {
    const seed: Row[] = [
      { _id: "clanView:0", _creationTime: old(20), clanId: 1 },
      { _id: "clanView:1", _creationTime: old(10), clanId: 1 },
      { _id: "clanView:2", _creationTime: fresh(1), clanId: 1 },
      { _id: "clanView:3", _creationTime: fresh(5), clanId: 1 },
    ];
    const { db, tables } = createDb({ clanView: seed });

    const result = await purgeGroupedPreserveLatest({ db } as any, {
      table: "clanView",
      cutoff: CUTOFF,
      indexName: "by_clanId",
      indexField: "clanId",
      groupKeyOf: (row) => row.clanId,
    });

    expect(result.deleted).toBe(2);
    expect(tables.clanView).toHaveLength(2);
    expect(tables.clanView!.every((r) => r._creationTime >= CUTOFF)).toBe(true);
  });

  it("banditView: groups by bandit id, preserves latest per bandit", async () => {
    const seed: Row[] = [
      // Bandit 1: 2 old, 1 fresh → only fresh survives.
      { _id: "banditView:0", _creationTime: old(20), id: 1 },
      { _id: "banditView:1", _creationTime: old(10), id: 1 },
      { _id: "banditView:2", _creationTime: fresh(5), id: 1 },
      // Bandit 2: 2 old, 0 fresh → latest old (banditView:4) survives.
      { _id: "banditView:3", _creationTime: old(30), id: 2 },
      { _id: "banditView:4", _creationTime: old(15), id: 2 },
    ];
    const { db, tables } = createDb({ banditView: seed });

    await purgeGroupedPreserveLatest({ db } as any, {
      table: "banditView",
      cutoff: CUTOFF,
      indexName: "by_bandit_id",
      indexField: "id",
      groupKeyOf: (row) => row.id,
    });

    const b1 = tables.banditView!.filter((r) => r.id === 1);
    expect(b1).toHaveLength(1);
    expect(b1[0]!._id).toBe("banditView:2");

    const b2 = tables.banditView!.filter((r) => r.id === 2);
    expect(b2).toHaveLength(1);
    expect(b2[0]!._id).toBe("banditView:4");
  });

  it("marketState (singleton): preserves only the most-recent row when all are old", async () => {
    const seed: Row[] = [
      { _id: "marketState:0", _creationTime: old(30) },
      { _id: "marketState:1", _creationTime: old(20) },
      { _id: "marketState:2", _creationTime: old(10) }, // latest
    ];
    const { db, tables } = createDb({ marketState: seed });

    await purgeGroupedPreserveLatest({ db } as any, {
      table: "marketState",
      cutoff: CUTOFF,
      indexName: null,
      indexField: null,
      groupKeyOf: () => null,
    });

    expect(tables.marketState).toHaveLength(1);
    expect(tables.marketState![0]!._id).toBe("marketState:2");
  });

  it("marketState: with fresh rows, fresh + (no old) survives", async () => {
    const seed: Row[] = [
      { _id: "marketState:0", _creationTime: old(30) },
      { _id: "marketState:1", _creationTime: fresh(1) },
      { _id: "marketState:2", _creationTime: fresh(5) },
    ];
    const { db, tables } = createDb({ marketState: seed });

    await purgeGroupedPreserveLatest({ db } as any, {
      table: "marketState",
      cutoff: CUTOFF,
      indexName: null,
      indexField: null,
      groupKeyOf: () => null,
    });

    // Old(30) is deleted because fresh(5) is strictly newer. Both fresh
    // rows are post-cutoff so they're never even fetched as "stale".
    expect(tables.marketState).toHaveLength(2);
    expect(tables.marketState!.map((r) => r._id).sort()).toEqual([
      "marketState:1",
      "marketState:2",
    ]);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// purgeStaleData — full cron entry point, all tables in one run
// ─────────────────────────────────────────────────────────────────────────

describe("purgeStaleData (cron entry)", () => {
  it("purges all retention-managed tables in one run", async () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(NOW);
    try {
      // Seed: 5 old + 3 fresh in each time-window table.
      const timeWindowSeed = {
        chainEvents: [
          ...rows("chainEvents", [old(10), old(8), old(6), old(4), old(2)]),
          ...rows("chainEvents", [fresh(1), fresh(2), fresh(3)]),
        ],
        agentLogs: [
          ...rows("agentLogs", [old(10), old(8), old(6), old(4), old(2)]),
          ...rows("agentLogs", [fresh(1), fresh(2), fresh(3)]),
        ],
        whispers: [
          ...rows("whispers", [old(10), old(8), old(6), old(4), old(2)]),
          ...rows("whispers", [fresh(1), fresh(2), fresh(3)]),
        ],
        orchEvents: [
          ...rows("orchEvents", [old(10), old(8), old(6), old(4), old(2)]),
          ...rows("orchEvents", [fresh(1), fresh(2), fresh(3)]),
        ],
        humanSteeringMessages: [
          ...rows("humanSteeringMessages", [old(10), old(8), old(6), old(4), old(2)]),
          ...rows("humanSteeringMessages", [fresh(1), fresh(2), fresh(3)]),
        ],
        pricePoint: [
          ...rows("pricePoint", [old(10), old(8), old(6), old(4), old(2)]),
          ...rows("pricePoint", [fresh(1), fresh(2), fresh(3)]),
        ],

        // clanView: 2 clans, each with 3 old + 2 fresh.
        clanView: [
          { _id: "clanView:0", _creationTime: old(20), clanId: 1 },
          { _id: "clanView:1", _creationTime: old(15), clanId: 1 },
          { _id: "clanView:2", _creationTime: old(10), clanId: 1 },
          { _id: "clanView:3", _creationTime: fresh(1), clanId: 1 },
          { _id: "clanView:4", _creationTime: fresh(5), clanId: 1 },
          { _id: "clanView:5", _creationTime: old(20), clanId: 2 },
          { _id: "clanView:6", _creationTime: old(15), clanId: 2 },
          { _id: "clanView:7", _creationTime: old(10), clanId: 2 },
          { _id: "clanView:8", _creationTime: fresh(1), clanId: 2 },
          { _id: "clanView:9", _creationTime: fresh(5), clanId: 2 },
        ],

        // banditView: bandit 1 (mix), bandit 2 (only old → must preserve latest).
        banditView: [
          { _id: "banditView:0", _creationTime: old(15), id: 1 },
          { _id: "banditView:1", _creationTime: old(5), id: 1 },
          { _id: "banditView:2", _creationTime: fresh(2), id: 1 },
          { _id: "banditView:3", _creationTime: old(20), id: 2 },
          { _id: "banditView:4", _creationTime: old(10), id: 2 }, // latest for #2
        ],

        // marketState: 2 old, 1 fresh.
        marketState: [
          { _id: "marketState:0", _creationTime: old(20) },
          { _id: "marketState:1", _creationTime: old(10) },
          { _id: "marketState:2", _creationTime: fresh(5) },
        ],
      };

      const { db, tables } = createDb(timeWindowSeed);

      const out = await (purgeStaleData as any)._handler({ db });

      // Time-window tables: only 3 fresh remain each.
      for (const t of [
        "chainEvents",
        "agentLogs",
        "whispers",
        "orchEvents",
        "humanSteeringMessages",
        "pricePoint",
      ]) {
        expect(tables[t]).toHaveLength(3);
        expect(tables[t]!.every((r) => r._creationTime >= CUTOFF)).toBe(true);
      }

      // clanView: each clan keeps its 2 fresh rows; both old groups deleted
      // because each clan has fresh rows newer than all olds.
      expect(tables.clanView).toHaveLength(4);
      expect(tables.clanView!.every((r) => r._creationTime >= CUTOFF)).toBe(
        true,
      );

      // banditView: bandit 1 keeps its fresh row; bandit 2 keeps its latest
      // old row (id=banditView:4) because no fresh row exists for bandit 2.
      expect(tables.banditView).toHaveLength(2);
      const b1 = tables.banditView!.filter((r) => r.id === 1);
      const b2 = tables.banditView!.filter((r) => r.id === 2);
      expect(b1).toHaveLength(1);
      expect(b1[0]!._id).toBe("banditView:2");
      expect(b2).toHaveLength(1);
      expect(b2[0]!._id).toBe("banditView:4");

      // marketState: 2 olds deleted (fresh is newer); fresh survives.
      expect(tables.marketState).toHaveLength(1);
      expect(tables.marketState![0]!._id).toBe("marketState:2");

      // Return value: totals are sane.
      expect(out.totalDeleted).toBeGreaterThan(0);
      expect(out.cutoff).toBe(CUTOFF);
      expect(out.results).toHaveLength(9);
    } finally {
      nowSpy.mockRestore();
    }
  });

  it("preserves resume-from-pause: never deletes the last row for any clan, bandit, or market", async () => {
    // Long-pause scenario: every row is old (older than 36h).
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(NOW);
    try {
      const { db, tables } = createDb({
        chainEvents: rows("chainEvents", [old(50), old(40)]),
        agentLogs: rows("agentLogs", [old(50)]),
        whispers: rows("whispers", [old(50)]),
        orchEvents: rows("orchEvents", [old(50)]),
        humanSteeringMessages: rows("humanSteeringMessages", [old(50)]),
        pricePoint: rows("pricePoint", [old(50)]),

        clanView: [
          { _id: "clanView:0", _creationTime: old(50), clanId: 1 },
          { _id: "clanView:1", _creationTime: old(40), clanId: 1 },
          { _id: "clanView:2", _creationTime: old(50), clanId: 2 },
        ],
        banditView: [
          { _id: "banditView:0", _creationTime: old(50), id: 99 },
          { _id: "banditView:1", _creationTime: old(40), id: 99 },
        ],
        marketState: [
          { _id: "marketState:0", _creationTime: old(60) },
          { _id: "marketState:1", _creationTime: old(50) },
        ],
      });

      await (purgeStaleData as any)._handler({ db });

      // All time-window tables: empty (no fresh, no preservation guarantee).
      expect(tables.chainEvents).toHaveLength(0);
      expect(tables.agentLogs).toHaveLength(0);
      expect(tables.whispers).toHaveLength(0);
      expect(tables.orchEvents).toHaveLength(0);
      expect(tables.humanSteeringMessages).toHaveLength(0);
      expect(tables.pricePoint).toHaveLength(0);

      // clanView: clan 1 keeps its latest (clanView:1); clan 2 keeps its
      // only row (clanView:2). Total 2 rows survive.
      expect(tables.clanView).toHaveLength(2);
      expect(tables.clanView!.map((r) => r._id).sort()).toEqual([
        "clanView:1",
        "clanView:2",
      ]);

      // banditView: latest of bandit 99 (banditView:1) survives.
      expect(tables.banditView).toHaveLength(1);
      expect(tables.banditView![0]!._id).toBe("banditView:1");

      // marketState: latest singleton (marketState:1) survives.
      expect(tables.marketState).toHaveLength(1);
      expect(tables.marketState![0]!._id).toBe("marketState:1");
    } finally {
      nowSpy.mockRestore();
    }
  });
});
