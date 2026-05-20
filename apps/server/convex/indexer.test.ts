import { describe, expect, it, vi } from "vitest";
import { encodeEventTopics, encodeAbiParameters, type Log } from "viem";
import { CLAN_WORLD_ABI } from "@clan-world/shared/adapters";
import {
  commitSnapshot,
  decodeClanWorldLogs,
  ingestEvents,
  lensAddress,
  planPollLogRange,
  pricePointFromEvent,
  stableJson,
} from "./indexer";

const address = "0x1111111111111111111111111111111111111111" as const;
const transactionHash =
  "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as const;

function createDb(tables: Record<string, any[]> = {}) {
  return {
    tables,
    db: {
      async insert(table: string, value: Record<string, unknown>) {
        tables[table] ??= [];
        const doc = {
          ...value,
          _id: `${table}:${tables[table].length}`,
          _creationTime: tables[table].length,
        };
        tables[table].push(doc);
        return doc._id;
      },
      async patch(id: string, value: Record<string, unknown>) {
        for (const rows of Object.values(tables)) {
          const index = rows.findIndex((row) => row._id === id);
          if (index >= 0) rows[index] = { ...rows[index], ...value };
        }
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
                ? b._creationTime - a._creationTime
                : a._creationTime - b._creationTime,
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

type CommitSnapshotTestHandler = (
  ctx: { db: ReturnType<typeof createDb>["db"] },
  args: {
    snapshot: {
      blockNumber: number;
      txHash?: string;
      heartbeatIntervalSeconds?: number;
      world: Record<string, unknown>;
      clans: unknown[];
    };
  },
) => Promise<{ tick?: number; clans?: number; skipped?: string }>;

const runCommitSnapshot = (
  commitSnapshot as unknown as { _handler: CommitSnapshotTestHandler }
)._handler;

function eventAbi(name: string) {
  const event = CLAN_WORLD_ABI.find(
    (item) => item.type === "event" && item.name === name,
  );
  if (!event || event.type !== "event")
    throw new Error(`missing event ${name}`);
  return event;
}

function fixtureLog(
  name: string,
  values: Record<string, unknown>,
  logIndex: number,
): Log {
  const abi = eventAbi(name);
  const indexed = abi.inputs.filter((input) => input.indexed);
  const unindexed = abi.inputs.filter((input) => !input.indexed);
  return {
    address,
    topics: encodeEventTopics({
      abi: [abi],
      eventName: name as never,
      args: Object.fromEntries(
        indexed.map((input) => [input.name, values[input.name]]),
      ),
    }) as [`0x${string}`, ...`0x${string}`[]],
    data: encodeAbiParameters(
      unindexed.map((input) => ({ name: input.name, type: input.type })),
      unindexed.map((input) => values[input.name]),
    ),
    blockHash:
      "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    blockNumber: 123n,
    transactionHash,
    transactionIndex: 2,
    logIndex,
    removed: false,
  };
}

describe("stableJson", () => {
  it("is key-order-independent", () => {
    const a = { b: 1, a: 2 };
    const b = { a: 2, b: 1 };
    expect(stableJson(a)).toBe(stableJson(b));
  });
  it("two worldSnapshot-like objects differing only in tick-family fields produce equal stableJson when those fields are stripped", () => {
    const strip = (o: Record<string, unknown>) => {
      const { tick, tickEpochStartedAt, tickEpochDurationMs, currentTickSeed, nextHeartbeatAtTick, lastUpdatedAt, lastUpdatedBlock, txHash, ...rest } = o;
      void tick; void tickEpochStartedAt; void tickEpochDurationMs; void currentTickSeed; void nextHeartbeatAtTick; void lastUpdatedAt; void lastUpdatedBlock; void txHash;
      return rest;
    };
    const prev = { tick: 10, tickEpochStartedAt: 1000, regions: [{ id: "A" }], clans: [] };
    const next = { tick: 11, tickEpochStartedAt: 1060, regions: [{ id: "A" }], clans: [] };
    expect(stableJson(strip(prev))).toBe(stableJson(strip(next)));
  });
});

describe("decodeClanWorldLogs", () => {
  it("decodes representative ClanWorld events with bigint-safe args", () => {
    const decoded = decodeClanWorldLogs([
      fixtureLog(
        "TickAdvanced",
        {
          closedTick: 4n,
          openedTick: 5n,
          tickSeed:
            "0x1234000000000000000000000000000000000000000000000000000000000000",
        },
        0,
      ),
      fixtureLog(
        "MissionAssigned",
        {
          clanId: 1,
          clansmanId: 7,
          missionNonce: 9n,
          action: 2,
          startRegion: 3,
          targetRegion: 4,
          startTick: 5n,
          arrivalTick: 6n,
        },
        1,
      ),
      fixtureLog(
        "ImmediateMarketActionExecuted",
        {
          clanId: 2,
          clansmanId: 8,
          action: 6,
          resourceIn: 1,
          amountIn: 100n,
          resourceOut: 2,
          amountOut: 50n,
          tick: 11n,
        },
        2,
      ),
      fixtureLog(
        "BanditAttackResolved",
        {
          banditId: 3,
          targetClanId: 4,
          defended: true,
          attackPower: 12,
          totalDefense: 13,
          wallLevelAfter: 2,
          stolenWood: 1n,
          stolenIron: 2n,
          stolenWheat: 3n,
          stolenFish: 4n,
          atTick: 20n,
        },
        3,
      ),
    ]);

    expect(decoded.map((event) => event.eventName)).toEqual([
      "TickAdvanced",
      "MissionAssigned",
      "ImmediateMarketActionExecuted",
      "BanditAttackResolved",
    ]);
    expect(decoded[0]?.args.closedTick).toBe("4");
    expect(decoded[1]?.args.missionNonce).toBe("9");
    expect(decoded[2]?.args.amountOut).toBe("50");
    expect(decoded[3]?.args.stolenFish).toBe("4");
  });
});

describe("pollLogs range planning", () => {
  it("uses INDEXER_START_BLOCK when there is no checkpoint", () => {
    const previousStartBlock = process.env.INDEXER_START_BLOCK;
    const previousDepth = process.env.INDEXER_CONFIRMATION_DEPTH;
    process.env.INDEXER_START_BLOCK = "12345";
    process.env.INDEXER_CONFIRMATION_DEPTH = "5";

    const range = planPollLogRange(null, 20_000n);

    expect(range.fromBlock).toBe(12_345n);
    // Capped at fromBlock + MAX_LOG_BLOCK_RANGE (9n for Alchemy free tier)
    // rather than safeLatest (19_995n).
    expect(range.toBlock).toBe(12_354n);
    expect(range.shouldPoll).toBe(true);

    if (previousStartBlock === undefined)
      delete process.env.INDEXER_START_BLOCK;
    else process.env.INDEXER_START_BLOCK = previousStartBlock;
    if (previousDepth === undefined)
      delete process.env.INDEXER_CONFIRMATION_DEPTH;
    else process.env.INDEXER_CONFIRMATION_DEPTH = previousDepth;
  });

  it("caps toBlock at the latest confirmed block", () => {
    const previousDepth = process.env.INDEXER_CONFIRMATION_DEPTH;
    process.env.INDEXER_CONFIRMATION_DEPTH = "5";

    const range = planPollLogRange({ lastBlock: 89 }, 100n);

    expect(range.fromBlock).toBe(90n);
    expect(range.toBlock).toBe(95n);

    if (previousDepth === undefined)
      delete process.env.INDEXER_CONFIRMATION_DEPTH;
    else process.env.INDEXER_CONFIRMATION_DEPTH = previousDepth;
  });
});

describe("lensAddress", () => {
  it("fails loudly when CLAN_WORLD_LENS_ADDRESS is missing", () => {
    const previous = process.env.CLAN_WORLD_LENS_ADDRESS;
    delete process.env.CLAN_WORLD_LENS_ADDRESS;

    expect(() => lensAddress()).toThrow(
      "CLAN_WORLD_LENS_ADDRESS must be set to a 0x-prefixed 20-byte address; see .env.template",
    );

    if (previous === undefined) delete process.env.CLAN_WORLD_LENS_ADDRESS;
    else process.env.CLAN_WORLD_LENS_ADDRESS = previous;
  });
});

describe("pricePointFromEvent", () => {
  it("indexes buys under the bought non-gold resource", () => {
    const pricePoint = pricePointFromEvent(
      {
        eventName: "ImmediateMarketActionExecuted",
        args: {
          action: 11,
          resourceIn: 4,
          amountIn: "200",
          resourceOut: 2,
          amountOut: "100",
          tick: "7",
        },
      },
      123,
    );

    expect(pricePoint?.resourceType).toBe("2");
    expect(pricePoint?.priceWoodGold).toBe("2000000000000000000");
  });

  it("indexes sells under the sold non-gold resource", () => {
    const pricePoint = pricePointFromEvent(
      {
        eventName: "ScheduledMarketActionExecuted",
        args: {
          action: 12,
          resourceIn: 1,
          amountIn: "100",
          resourceOut: 4,
          amountOut: "300",
          settledAtTick: "8",
        },
      },
      124,
    );

    expect(pricePoint?.resourceType).toBe("1");
    expect(pricePoint?.priceWoodGold).toBe("3000000000000000000");
  });
});

describe("ingestEvents checkpoint isolation", () => {
  const event = {
    eventName: "TickAdvanced",
    args: {
      closedTick: "1",
      openedTick: "2",
      tickSeed: "0x1234",
    },
    transactionHash,
    blockNumber: 105,
    logIndex: 0,
  };

  it("does not advance the pollLogs cursor for webhook ingestion", async () => {
    const { db, tables } = createDb({
      eventCheckpoint: [
        { _id: "eventCheckpoint:0", _creationTime: 0, lastBlock: 100 },
      ],
    });

    await (ingestEvents as any)._handler(
      { db },
      {
        events: [event],
        blockNumber: 105,
        txHash: transactionHash,
        advanceCheckpoint: false,
      },
    );

    expect(tables.eventCheckpoint?.[0]?.lastBlock).toBe(100);
    expect(tables.chainEvents).toHaveLength(1);
  });

  it("advances the pollLogs cursor when requested by the poller", async () => {
    const { db, tables } = createDb({
      eventCheckpoint: [
        { _id: "eventCheckpoint:0", _creationTime: 0, lastBlock: 100 },
      ],
    });

    await (ingestEvents as any)._handler(
      { db },
      {
        events: [event],
        blockNumber: 105,
        txHash: transactionHash,
        advanceCheckpoint: true,
      },
    );

    expect(tables.eventCheckpoint?.[0]?.lastBlock).toBe(105);
  });
});

describe("ingestEvents allowlist", () => {
  it("skips unknown event names with structured warning and rejected counter", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const { db, tables } = createDb({
        eventCheckpoint: [
          { _id: "eventCheckpoint:0", _creationTime: 0, lastBlock: 100 },
        ],
      });

      const goodEvent = {
        eventName: "TickAdvanced",
        args: { closedTick: "1", openedTick: "2", tickSeed: "0x1234" },
        transactionHash,
        blockNumber: 105,
        logIndex: 0,
      };
      const badEvent = {
        eventName: "FakeEvent",
        args: { foo: "bar" },
        transactionHash,
        blockNumber: 105,
        logIndex: 1,
      };

      const result = await (ingestEvents as any)._handler(
        { db },
        {
          events: [goodEvent, badEvent],
          blockNumber: 105,
          txHash: transactionHash,
          advanceCheckpoint: false,
        },
      );

      expect(result.inserted).toBe(1);
      expect(result.rejected).toBe(1);
      expect(tables.chainEvents).toHaveLength(1);
      expect(tables.chainEvents?.[0]?.eventName).toBe("TickAdvanced");
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("FakeEvent"),
        expect.objectContaining({ eventName: "FakeEvent" }),
      );
    } finally {
      warnSpy.mockRestore();
    }
  });
});

describe("legacy snapshot backfill", () => {
  it("skips append-only view writes when only audit fields change", async () => {
    const { db, tables } = createDb();
    const now = vi.spyOn(Date, "now");
    now.mockReturnValue(1_000_000);

    const market = {
      currentTick: 12,
      currentTickQueue: [],
      nextTickQueue: [],
      wood: {
        resourceToken: "0x0000000000000000000000000000000000000001",
        resourceReserve: "100",
        goldReserve: "200",
        spotPriceGoldPerResource: "2",
      },
      wheat: {
        resourceToken: "0x0000000000000000000000000000000000000002",
        resourceReserve: "300",
        goldReserve: "600",
        spotPriceGoldPerResource: "2",
      },
      fish: {
        resourceToken: "0x0000000000000000000000000000000000000003",
        resourceReserve: "400",
        goldReserve: "800",
        spotPriceGoldPerResource: "2",
      },
      iron: {
        resourceToken: "0x0000000000000000000000000000000000000004",
        resourceReserve: "500",
        goldReserve: "1000",
        spotPriceGoldPerResource: "2",
      },
    };
    const bandit = {
      exists: true,
      banditId: 1,
      currentRegion: 2,
      state: 3,
      attackPower: 4,
      tier: 1,
      attackAttemptsMade: 0,
      maxAttemptsRemaining: 2,
      stateEnteredTick: 10,
      nextActionTick: 13,
      carryWood: "1",
      carryIron: "2",
      carryWheat: "3",
      carryFish: "4",
      projectedTargetClanId: 2,
      projectedTargetLootValue: "99",
    };
    const clan = {
      clan: {
        clan: {
          clanId: 2,
          owner: "0x0000000000000000000000000000000000000000",
          goldBalance: "250",
          blueprintBalance: "5",
          vaultWood: "1000000000000000000",
          vaultIron: "2000000000000000000",
          vaultWheat: "3000000000000000000",
          vaultFish: "4000000000000000000",
        },
        derivedAtTick: 12,
      },
    };

    await (commitSnapshot as any)._handler(
      { db },
      {
        snapshot: {
          blockNumber: 99,
          world: { currentTick: 12 },
          market,
          bandit,
          clans: [clan],
        },
      },
    );

    // Second refresh: chain clock advances (tick 12 → 13) but on-chain content
    // is unchanged. Same blockNumber (99) keeps clanView's HEAD-logic delta
    // strip list happy — `lastUpdatedBlock` isn't stripped by clanView yet
    // (that refinement lives in PR #338). After PR #338 lands we can also
    // exercise the blockNumber-advance case. Bumping `market.currentTick` to 13
    // exercises the MARKET_STATE_NON_CONTENT_FIELDS strip of `currentTick` /
    // `lastUpdatedTick` — those advance every tick even when the AMM pools
    // are static.
    now.mockReturnValue(1_015_000);
    await (commitSnapshot as any)._handler(
      { db },
      {
        snapshot: {
          blockNumber: 99,
          world: { currentTick: 13 },
          market: { ...market, currentTick: 13 },
          bandit,
          clans: [clan],
        },
      },
    );

    expect(tables.marketState).toHaveLength(1);
    expect(tables.banditView).toHaveLength(1);
    expect(tables.clanView).toHaveLength(1);

    now.mockRestore();
  });

  it("commitSnapshot writes non-empty legacy clans from clanView rows", async () => {
    const { db, tables } = createDb();

    await runCommitSnapshot(
      { db },
      {
        snapshot: {
          blockNumber: 99,
          world: { currentTick: 12 },
          clans: [
            {
              clan: {
                clan: {
                  clanId: 2,
                  owner: "0x0000000000000000000000000000000000000000",
                  goldBalance: "250",
                  blueprintBalance: "5",
                  vaultWood: "1000000000000000000",
                  vaultIron: "2000000000000000000",
                  vaultWheat: "3000000000000000000",
                  vaultFish: "4000000000000000000",
                },
              },
            },
          ],
        },
      },
    );

    const worldSnapshots = tables.worldSnapshot ?? [];
    expect(worldSnapshots).toHaveLength(1);
    expect(worldSnapshots[0].clans).toEqual([
      {
        id: "2",
        name: "Clan 2",
        treasury: "250",
        goldBalance: "250",
        blueprintBalance: "5",
        vaultWood: "1000000000000000000",
        vaultIron: "2000000000000000000",
        vaultWheat: "3000000000000000000",
        vaultFish: "4000000000000000000",
        baseRegion: 0,
        baseLevel: 0,
        wallLevel: 0,
        monumentLevel: 0,
        livingClansmen: 0,
        owner: "0x0000000000000000000000000000000000000000",
        clansmen: [],
      },
    ]);
    expect(worldSnapshots[0].regions).toHaveLength(8);
  });

  it("preserves tick epoch start across same-tick snapshot refreshes", async () => {
    const { db, tables } = createDb();
    const now = vi.spyOn(Date, "now");
    now.mockReturnValue(1_000_000);

    await runCommitSnapshot(
      { db },
      {
        snapshot: {
          blockNumber: 99,
          world: { currentTick: 12 },
          clans: [],
        },
      },
    );

    now.mockReturnValue(1_015_000);
    await runCommitSnapshot(
      { db },
      {
        snapshot: {
          blockNumber: 100,
          world: { currentTick: 12 },
          clans: [],
        },
      },
    );

    const sameTickSnapshot = tables.worldSnapshot?.[0];
    expect(sameTickSnapshot.tickEpochStartedAt).toBe(1_000);
    expect(sameTickSnapshot.tickEpochDurationMs).toBe(60_000);

    now.mockReturnValue(1_060_000);
    await runCommitSnapshot(
      { db },
      {
        snapshot: {
          blockNumber: 101,
          world: { currentTick: 13 },
          clans: [],
        },
      },
    );

    // tickClock is always patched — it's the authoritative epoch source after the
    // worldSnapshot delta-check (#333). worldSnapshot may not be updated when
    // content (clans, regions) didn't change, so read epoch from tickClock.
    const advancedClock = tables.tickClock?.[0];
    expect(advancedClock.tick).toBe(13);
    expect(advancedClock.tickEpochStartedAt).toBe(1_060);
    expect(advancedClock.tickEpochDurationMs).toBe(60_000);

    now.mockRestore();
  });

  it("persists on-chain heartbeatIntervalSeconds and patches interval-only changes", async () => {
    const { db, tables } = createDb();
    const now = vi.spyOn(Date, "now");
    now.mockReturnValue(2_000_000);

    await runCommitSnapshot(
      { db },
      {
        snapshot: {
          blockNumber: 200,
          heartbeatIntervalSeconds: 45,
          world: { currentTick: 20 },
          clans: [],
        },
      },
    );

    expect(tables.tickClock?.[0]?.heartbeatIntervalSeconds).toBe(45);
    expect(tables.tickClock?.[0]?.tickEpochDurationMs).toBe(45_000);
    expect(tables.worldSnapshot?.[0]?.heartbeatIntervalSeconds).toBe(45);
    expect(tables.worldSnapshot?.[0]?.tickEpochDurationMs).toBe(45_000);

    await runCommitSnapshot(
      { db },
      {
        snapshot: {
          blockNumber: 201,
          heartbeatIntervalSeconds: 30,
          world: { currentTick: 20 },
          clans: [],
        },
      },
    );

    expect(tables.tickClock?.[0]?.heartbeatIntervalSeconds).toBe(30);
    expect(tables.tickClock?.[0]?.tickEpochDurationMs).toBe(30_000);
    expect(tables.worldSnapshot?.[0]?.heartbeatIntervalSeconds).toBe(30);
    expect(tables.worldSnapshot?.[0]?.tickEpochDurationMs).toBe(30_000);

    now.mockRestore();
  });

  it("refreshes tick epoch start when same-tick snapshot unpauses", async () => {
    const { db, tables } = createDb({
      worldSnapshot: [
        {
          _id: "worldSnapshot:0",
          _creationTime: 0,
          tick: 12,
          tickEpochStartedAt: 1_000,
          tickEpochDurationMs: 60_000,
          worldPaused: true,
          pausedAtTs: 1_000,
          clans: [],
        },
      ],
    });
    const now = vi.spyOn(Date, "now");
    now.mockReturnValue(1_015_000);

    await runCommitSnapshot(
      { db },
      {
        snapshot: {
          blockNumber: 100,
          world: { currentTick: 12, worldPaused: false },
          clans: [],
        },
      },
    );

    expect(tables.worldSnapshot?.[0]?.tickEpochStartedAt).toBe(1_015);
    expect(tables.worldSnapshot?.[0]?.worldPaused).toBe(false);

    now.mockRestore();
  });

  it("skips stale same-tick snapshot refreshes from older blocks", async () => {
    const { db, tables } = createDb({
      worldSnapshot: [
        {
          _id: "worldSnapshot:0",
          _creationTime: 0,
          tick: 12,
          lastUpdatedBlock: 100,
          tickEpochStartedAt: 1_000,
          tickEpochDurationMs: 60_000,
          clans: [{ id: "current" }],
        },
      ],
    });

    const result = await runCommitSnapshot(
      { db },
      {
        snapshot: {
          blockNumber: 99,
          world: { currentTick: 12 },
          clans: [],
        },
      },
    );

    expect(result.skipped).toBe("stale-snapshot");
    expect(tables.worldSnapshot?.[0]?.lastUpdatedBlock).toBe(100);
    expect(tables.worldSnapshot?.[0]?.clans).toEqual([{ id: "current" }]);
  });

  it("does not rewrite worldSnapshot content when only monotonic clansman fields change (tick still advances)", async () => {
    const { db, tables } = createDb();

    const makeClanView = (cooldownEndsAtTs: number) => ({
      // view.clan.clan = the on-chain struct; view.clan = derived view with effectiveRegion
      clan: {
        clan: {
          clanId: 1,
          owner: "0x0000000000000000000000000000000000000000",
          baseRegion: 1,
          clanState: 0,
          baseLevel: 1,
          wallLevel: 1,
          monumentLevel: 0,
          livingClansmen: 1,
          isStarving: false,
          starvationStartsAtTick: 0,
          coldDamage: 0,
          goldBalance: "0",
          blueprintBalance: "0",
          vaultWood: "0",
          vaultIron: "0",
          vaultWheat: "0",
          vaultFish: "0",
          lootValue: "0",
        },
        derivedAtTick: 1,
        effectiveRegion: 1,
      },
      // view.clansmen = top-level field consumed by the handler (line 611)
      clansmen: [
        {
          clansman: {
            clansman: {
              clansmanId: 1,
              clanId: 1,
              state: 0,
              currentRegion: 1,
              cooldownEndsAtTs,       // monotonic — stripped by stableClansman
              lastMissionNonce: cooldownEndsAtTs,  // monotonic — stripped
              carryWood: "0",
              carryIron: "0",
              carryWheat: "0",
              carryFish: "0",
            },
            effectiveRegion: 1,
          },
          activeMission: { active: false, action: 0, startRegion: 1, targetRegion: 1 },
        },
      ],
    });

    // First commit — establishes clanView + worldSnapshot at tick 1.
    await (commitSnapshot as any)._handler(
      { db },
      {
        snapshot: {
          blockNumber: 1,
          world: { currentTick: 1 },
          clans: [makeClanView(100)],
        },
      },
    );

    const clansAfterFirst = tables.worldSnapshot?.[0]?.clans;

    // Second commit — tick advances to 2, but only cooldownEndsAtTs/lastMissionNonce
    // change on the clansman (monotonic, stripped by stableClansman).
    await (commitSnapshot as any)._handler(
      { db },
      {
        snapshot: {
          blockNumber: 2,
          world: { currentTick: 2 },
          clans: [makeClanView(101)],
        },
      },
    );

    // Per PR #402 codex P1: `tick` is intentionally included in the delta-check
    // so the worldSnapshot tick advances for downstream readers (useCurrentWorldTick,
    // WorldMap bandit-resolution, VaultTab T-label). Therefore tick is now 2.
    expect(tables.worldSnapshot?.[0]?.tick).toBe(2);
    // But the clans payload is stable — stableClansman strips the monotonic
    // fields, so the actual clansman content the WorldMap reads is unchanged.
    expect(tables.worldSnapshot?.[0]?.clans).toEqual(clansAfterFirst);
  });
});
