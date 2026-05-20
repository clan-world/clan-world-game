import { describe, expect, it, vi } from "vitest";
import { advanceTick } from "./heartbeat";

// Minimal in-memory Convex-like DB harness, matching the pattern used in
// runnerStatus.test.ts. We test advanceTick._handler directly because the
// mutation wrapper isn't introspectable in unit tests.
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
    },
  };
}

const NOW_SECONDS = 1_700_000_000;
const baseSnap = {
  tick: 5,
  tickEpochStartedAt: NOW_SECONDS - 120,
  tickEpochDurationMs: 60_000,
  heartbeatIntervalSeconds: 60,
  // Season + winter state — opus 4.7 R2 M2 says these MUST be preserved
  currentSeasonNumber: 7,
  seasonStartTick: 1,
  seasonEndTick: 100,
  winterActive: false,
  winterStartsAtTick: 30,
  winterEndsAtTick: 80,
  worldPaused: false,
  // codex 5.3 R3 MED — season state, MUST be preserved through synthetic ticks
  seasonFinalized: true,
  // Per-block provenance — opus 4.7 R2 M2 says these MUST be cleared
  txHash: "0xabcd",
  lastUpdatedAt: NOW_SECONDS - 60,
  lastUpdatedBlock: 12345,
  currentTickSeed: "0xseed",
  // Required schema fields
  regions: [{ id: "forest", name: "Forest", ownerClanId: null }],
  clans: [{ id: "1", name: "AClan", treasury: "0x0" }],
  nextHeartbeatAtTick: 6,
};

describe("advanceTick", () => {
  it("synthetic tick preserves season + winter state via prevSnap spread (gemini R1 HIGH)", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW_SECONDS * 1000);
    const { tables, db } = createDb({ worldSnapshot: [{ ...baseSnap, _id: "worldSnapshot:0", _creationTime: 1 }] });

    const result = await (advanceTick as any)._handler({ db });

    expect(result).toEqual({ status: "ok", tick: 6 });
    const inserted = tables.worldSnapshot![1];
    expect(inserted.tick).toBe(6);
    // SEASON STATE PRESERVED
    expect(inserted.currentSeasonNumber).toBe(7);
    expect(inserted.seasonStartTick).toBe(1);
    expect(inserted.seasonEndTick).toBe(100);
    expect(inserted.winterActive).toBe(false);
    expect(inserted.winterStartsAtTick).toBe(30);
    expect(inserted.winterEndsAtTick).toBe(80);
    expect(inserted.worldPaused).toBe(false);
    expect(inserted.seasonFinalized).toBe(true);
    expect(inserted.regions).toEqual(baseSnap.regions);
    expect(inserted.clans).toEqual(baseSnap.clans);
    vi.useRealTimers();
  });

  it("synthetic tick clears per-block provenance + overrides nextHeartbeatAtTick (opus 4.7 R2 M2)", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW_SECONDS * 1000);
    const { tables, db } = createDb({ worldSnapshot: [{ ...baseSnap, _id: "worldSnapshot:0", _creationTime: 1 }] });

    await (advanceTick as any)._handler({ db });

    const inserted = tables.worldSnapshot![1];
    // PER-BLOCK PROVENANCE CLEARED
    expect(inserted.txHash).toBeUndefined();
    expect(inserted.lastUpdatedAt).toBeUndefined();
    expect(inserted.lastUpdatedBlock).toBeUndefined();
    expect(inserted.currentTickSeed).toBeUndefined();
    // nextHeartbeatAtTick overridden to newTick + 1
    expect(inserted.nextHeartbeatAtTick).toBe(7);
    vi.useRealTimers();
  });

  it("tickClock present: baseTick comes from clockRow, advances by 1 (not from snap)", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW_SECONDS * 1000);
    // tickClock at tick 10, worldSnapshot at older tick 5 — verifies
    // clockRow wins for baseTick (tickClock is the authoritative cursor
    // per the PR #402 split). Advances 10 → 11, NOT 5 → 6.
    const { tables, db } = createDb({
      worldSnapshot: [{ ...baseSnap, _id: "worldSnapshot:0", _creationTime: 1 }],
      tickClock: [{ _id: "tickClock:0", _creationTime: 1, tick: 10, tickEpochStartedAt: NOW_SECONDS - 120, tickEpochDurationMs: 60_000, heartbeatIntervalSeconds: 60 }],
    });

    const result = await (advanceTick as any)._handler({ db });

    expect(result).toEqual({ status: "ok", tick: 11 });
    expect(tables.worldSnapshot![1].tick).toBe(11);
    expect(tables.tickClock![0].tick).toBe(11);  // patched, not inserted
  });

  it("cold-start path: snap exists, clockRow is null → both worldSnapshot insert + tickClock insert", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW_SECONDS * 1000);
    const { tables, db } = createDb({ worldSnapshot: [{ ...baseSnap, _id: "worldSnapshot:0", _creationTime: 1 }] });

    const result = await (advanceTick as any)._handler({ db });

    expect(result).toEqual({ status: "ok", tick: 6 });
    expect(tables.worldSnapshot).toHaveLength(2);
    expect(tables.tickClock).toHaveLength(1);
    expect(tables.tickClock![0].tick).toBe(6);
    expect(tables.tickClock![0].tickEpochDurationMs).toBe(60_000);
    expect(tables.tickClock![0].heartbeatIntervalSeconds).toBe(60);
    vi.useRealTimers();
  });

  it("returns no-op when no snapshot exists at all", async () => {
    const { db } = createDb({});
    const result = await (advanceTick as any)._handler({ db });
    expect(result).toEqual({ status: "no-op", reason: "no snapshot to refresh" });
  });

  it("crosses season boundary: recomputes season fields + resets seasonFinalized (codex R4 MED)", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW_SECONDS * 1000);
    // Previous snap is at the LAST tick of season 7. The next synthetic tick
    // crosses into season 8 — season fields must recompute, seasonFinalized
    // must reset to false (no chain finalize ran in synthetic mode).
    const boundarySnap = {
      ...baseSnap,
      tick: 720,                       // last tick of season 7 (SEASON_LEN=360)
      seasonStartTick: 360,            // season 7 spans [360, 720)
      seasonEndTick: 720,
      currentSeasonNumber: 7,
      seasonFinalized: true,           // season 7 was finalized on chain
    };
    const { tables, db } = createDb({ worldSnapshot: [{ ...boundarySnap, _id: "worldSnapshot:0", _creationTime: 1 }] });

    await (advanceTick as any)._handler({ db });

    const inserted = tables.worldSnapshot![1];
    expect(inserted.tick).toBe(721);
    // Season 8: starts at 720, ends at 1080
    expect(inserted.currentSeasonNumber).toBe(3);  // Math.floor(721/360)+1
    expect(inserted.seasonStartTick).toBe(720);
    expect(inserted.seasonEndTick).toBe(1080);
    // Critical: new season is NOT yet finalized
    expect(inserted.seasonFinalized).toBe(false);
    vi.useRealTimers();
  });

  it("returns no-op when current epoch has not elapsed yet", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW_SECONDS * 1000);
    const futureSnap = {
      ...baseSnap,
      tickEpochStartedAt: NOW_SECONDS - 10,  // 10s into a 60s epoch
      tickEpochDurationMs: 60_000,
    };
    const { db } = createDb({ worldSnapshot: [{ ...futureSnap, _id: "worldSnapshot:0", _creationTime: 1 }] });

    const result = await (advanceTick as any)._handler({ db });

    expect(result).toEqual({ status: "no-op", reason: "epoch not yet elapsed" });
    vi.useRealTimers();
  });
});
