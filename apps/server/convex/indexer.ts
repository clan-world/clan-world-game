import { v } from "convex/values";
import {
  internalAction,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import { internal } from "./_generated/api";
import {
  iClanWorldAbi,
  iClanWorldLensAbi,
  isClanWorldEventName,
} from "@clan-world/contract-types";
import type { IClanWorldAbiEventName } from "@clan-world/contract-types";
import {
  createPublicClient,
  http,
  parseEventLogs,
  type ContractFunctionName,
  type Hex,
  type Log,
  type ParseEventLogsReturnType,
} from "viem";
import {
  HEARTBEAT_INTERVAL_SECONDS,
  RESOURCE_GOLD,
} from "@clan-world/shared/generated/constants";
import { baseSepolia } from "@clan-world/shared/adapters";
import type { Doc } from "./_generated/dataModel";
import { resetLocked } from "./resetLock";

const MAX_CLANS = 12;
// MarketState struct fields are wood/wheat/fish/iron, which is distinct from
// ResourceType enum order (wood/iron/wheat/fish) used by RESOURCE_NAMES_BY_ENUM.
const MARKET_POOL_KEYS = ["wood", "wheat", "fish", "iron"] as const;
const DEFAULT_CONFIRMATION_DEPTH = 5;
// Alchemy free tier caps eth_getLogs at 10 blocks. PAYG allows 10K.
// Default to 9n so we stay under the free-tier cap when running against
// a non-PAYG RPC (e.g. demo deployment).
const MAX_LOG_BLOCK_RANGE = 9n;
const DEFAULT_COLD_START_LOOKBACK = 100n;
type ReadContractMutability = "view" | "pure";
type ClanWorldFunctionName = ContractFunctionName<
  typeof iClanWorldAbi,
  ReadContractMutability
>;
type LensFunctionName = ContractFunctionName<
  typeof iClanWorldLensAbi,
  ReadContractMutability
>;
const GET_WORLD_SNAPSHOT = "getWorldSnapshot" satisfies LensFunctionName;
const GET_MARKET_STATE = "getMarketState" satisfies LensFunctionName;
const GET_ACTIVE_BANDIT_VIEW =
  "getActiveBanditView" satisfies LensFunctionName;
const GET_CLAN_IDS = "getClanIds" satisfies ClanWorldFunctionName;
const GET_CLAN_FULL_VIEW = "getClanFullView" satisfies LensFunctionName;
const LEGACY_REGIONS = [
  { id: "forest", name: "Forest", ownerClanId: null },
  { id: "mountains", name: "Mountains", ownerClanId: null },
  { id: "unicorn-town", name: "Unicorn Town", ownerClanId: null },
  { id: "west-farmland", name: "West Farmland", ownerClanId: null },
  { id: "east-farmland", name: "East Farmland", ownerClanId: null },
  { id: "west-docks", name: "West Docks", ownerClanId: null },
  { id: "east-docks", name: "East Docks", ownerClanId: null },
  { id: "deep-sea", name: "Deep Sea", ownerClanId: null },
];
const indexerApi = internal.indexer;

/**
 * Key-order-stable JSON serializer for Convex-safe values.
 * Accepts: string, number, boolean, null, plain object, array.
 *
 * Undefined-key semantics: matches JSON.stringify — keys with undefined values
 * are DROPPED from objects; undefined array elements become null. This makes
 * `stableJson({ a: 1, b: undefined })` equal to `stableJson({ a: 1 })`, which
 * means callers can use the spread-with-undefined-override pattern to strip
 * fields from a Convex doc before comparison:
 *
 *   const previousComparable = { ...prev, _id: undefined, _creationTime: undefined };
 *   if (stableJson(previousComparable) === stableJson(nextView)) // ...
 *
 * Without this drop-undefined behavior, the spread pattern leaves stripped keys
 * present-but-undefined, making the two strings always differ (super-swarm r3
 * H1, fix-round 5).
 *
 * Do NOT pass: Date, BigInt, Symbol — these are not valid in Convex
 * documents and will serialize incorrectly (Date→{}, BigInt→throws).
 */
export function stableJson(val: unknown): string {
  if (val === undefined) return "undefined";  // sentinel; callers shouldn't pass undefined at top-level
  if (val === null || typeof val !== "object") return JSON.stringify(val);
  if (Array.isArray(val)) {
    // JSON.stringify converts array `undefined` elements to `null`.
    return `[${val.map(v => v === undefined ? "null" : stableJson(v)).join(",")}]`;
  }
  const obj = val as Record<string, unknown>;
  return `{${Object.keys(obj)
    .sort()
    .filter(k => obj[k] !== undefined)
    .map(k => `${JSON.stringify(k)}:${stableJson(obj[k])}`)
    .join(",")}}`;
}

type ParsedIndexerEvent = {
  eventName: IClanWorldAbiEventName;
  args: Record<string, unknown>;
  address?: string;
  blockHash?: string | null;
  blockNumber?: bigint | number | null;
  transactionHash?: string | null;
  transactionIndex?: number | null;
  logIndex?: number | null;
};

type SnapshotPayload = {
  blockNumber?: number;
  txHash?: string;
  world: Record<string, unknown>;
  market?: Record<string, unknown>;
  bandit?: Record<string, unknown>;
  clans: Record<string, unknown>[];
};

type ParsedClanWorldLog = ParseEventLogsReturnType<
  typeof iClanWorldAbi,
  undefined,
  false
>[number];

type LegacyClanView = Partial<Doc<"clanView">> &
  Pick<Doc<"clanView">, "clanId">;

const isPresent = <T>(value: T | null | undefined): value is T =>
  value !== null && value !== undefined;

// Non-content fields stripped before delta-comparison in commitSnapshot's
// banditView / marketState writes (see #334). Convex auto-fields (_id,
// _creationTime) plus per-insert audit/timestamp fields that advance every
// heartbeat even when on-chain state is identical. marketState additionally
// carries tick cursors (currentTick / lastUpdatedTick) that advance every
// tick — these must be stripped too or the no-op guard never fires.
const BANDIT_VIEW_NON_CONTENT_FIELDS = [
  "_id",
  "_creationTime",
  "refreshedAt",
  "lastUpdatedBlock",
] as const;
const MARKET_STATE_NON_CONTENT_FIELDS = [
  "_id",
  "_creationTime",
  "refreshedAt",
  "lastUpdatedBlock",
  "currentTick",
  "lastUpdatedTick",
] as const;

const stripNonContentFields = (
  row: object | null | undefined,
  fieldsToStrip: readonly string[],
): Record<string, unknown> | undefined => {
  if (!row) return undefined;
  const skip = new Set(fieldsToStrip);
  return Object.fromEntries(
    Object.entries(row).filter(([key]) => !skip.has(key)),
  );
};

// JSON.stringify-based content equality. Matches the existing `clanView`
// delta pattern in `commitSnapshot` (`previousComparable` block). Field
// order in object literals is stable across V8 for same-shape inserts,
// so this is sound without a deep-equal dep — and consistent with the
// pattern that PR #338 may later upgrade to fast-deep-equal.
const isContentEqualIgnoring = (
  previous: object | null | undefined,
  next: object,
  fieldsToStrip: readonly string[],
) =>
  JSON.stringify(stripNonContentFields(previous, fieldsToStrip)) ===
  JSON.stringify(stripNonContentFields(next, fieldsToStrip));

export function bigintSafe(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(bigintSafe);
  if (!value || typeof value !== "object") return value;

  const out: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value)) {
    out[key] = bigintSafe(nested);
  }
  return out;
}

export function decodeClanWorldLogs(
  logs: readonly Log[],
): ParsedIndexerEvent[] {
  return parseEventLogs({
    abi: iClanWorldAbi,
    logs: [...logs],
    strict: false,
  }).map((event: ParsedClanWorldLog) => ({
    eventName: event.eventName,
    args: bigintSafe(event.args ?? {}) as Record<string, unknown>,
    address: event.address,
    blockHash: event.blockHash,
    blockNumber: event.blockNumber,
    transactionHash: event.transactionHash,
    transactionIndex: event.transactionIndex,
    logIndex: event.logIndex,
  }));
}

const asNumber = (value: unknown, fallback = 0): number => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string" && value !== "") return Number(value);
  return fallback;
};

const asString = (value: unknown, fallback = "0"): string =>
  typeof value === "string"
    ? value
    : value === undefined || value === null
      ? fallback
      : String(value);

const asBool = (value: unknown, fallback = false): boolean =>
  typeof value === "boolean" ? value : fallback;

const objectAt = (value: unknown, key: string): Record<string, unknown> => {
  if (!value || typeof value !== "object") return {};
  const nested = (value as Record<string, unknown>)[key];
  return nested && typeof nested === "object"
    ? (nested as Record<string, unknown>)
    : {};
};

function createClient() {
  const rpcUrl = process.env.RPC_URL_PRIMARY;
  if (!rpcUrl)
    throw new Error(
      "RPC_URL_PRIMARY is required for CLANWORLD_USE_REAL_INDEXER",
    );
  return createPublicClient({ chain: baseSepolia, transport: http(rpcUrl) });
}

function engineAddress(): Hex {
  const address = process.env.CLAN_WORLD_CONTRACT_ADDRESS;
  if (!address || !/^0x[0-9a-fA-F]{40}$/.test(address)) {
    throw new Error(
      "CLAN_WORLD_CONTRACT_ADDRESS must be a 0x-prefixed 20-byte address",
    );
  }
  return address as Hex;
}

export function lensAddress(): Hex {
  const address = process.env.CLAN_WORLD_LENS_ADDRESS;
  if (!address || !/^0x[0-9a-fA-F]{40}$/.test(address)) {
    throw new Error(
      "CLAN_WORLD_LENS_ADDRESS must be set to a 0x-prefixed 20-byte address; see .env.template",
    );
  }
  return address as Hex;
}

function eventNumber(
  event: ParsedIndexerEvent,
  key: string,
): number | undefined {
  const value = event.args[key];
  if (value === undefined || value === null) return undefined;
  return asNumber(value);
}

export function pricePointFromEvent(
  event: ParsedIndexerEvent,
  blockNumber: number,
) {
  if (
    event.eventName !== "ImmediateMarketActionExecuted" &&
    event.eventName !== "ScheduledMarketActionExecuted"
  ) {
    return undefined;
  }
  const resourceIn = asNumber(event.args.resourceIn, 0);
  const resourceOut = asNumber(event.args.resourceOut, 0);
  const amountIn = BigInt(asString(event.args.amountIn, "0"));
  const amountOut = BigInt(asString(event.args.amountOut, "0"));
  const goldResourceId = Number(RESOURCE_GOLD);
  const isBuy = resourceIn === goldResourceId;
  const resourceType = isBuy ? resourceOut : resourceIn;
  const resourceAmount = isBuy ? amountOut : amountIn;
  const goldAmount = isBuy ? amountIn : amountOut;
  const price =
    resourceAmount > 0n
      ? ((goldAmount * 1_000_000_000_000_000_000n) / resourceAmount).toString()
      : "0";
  return {
    tick: asNumber(event.args.tick ?? event.args.settledAtTick),
    resourceType: String(resourceType),
    priceWoodGold: price,
    blockNumber,
    observedAt: Date.now(),
  };
}

const envBigInt = (key: string): bigint | undefined => {
  const value = process.env[key];
  if (!value) return undefined;
  try {
    const parsed = BigInt(value);
    return parsed >= 0n ? parsed : undefined;
  } catch {
    return undefined;
  }
};

export const indexerConfirmationDepth = (): bigint =>
  envBigInt("INDEXER_CONFIRMATION_DEPTH") ?? BigInt(DEFAULT_CONFIRMATION_DEPTH);

export function planPollLogRange(
  checkpoint: { lastBlock: number } | null,
  latest: bigint,
): {
  fromBlock: bigint;
  toBlock: bigint;
  safeLatest: bigint;
  shouldPoll: boolean;
} {
  const depth = indexerConfirmationDepth();
  const safeLatest = latest > depth ? latest - depth : 0n;
  const coldStartBlock =
    envBigInt("INDEXER_START_BLOCK") ??
    (latest > DEFAULT_COLD_START_LOOKBACK
      ? latest - DEFAULT_COLD_START_LOOKBACK
      : 1n);
  const fromBlock = checkpoint
    ? BigInt(checkpoint.lastBlock + 1)
    : coldStartBlock;
  const toBlock =
    fromBlock + MAX_LOG_BLOCK_RANGE < safeLatest
      ? fromBlock + MAX_LOG_BLOCK_RANGE
      : safeLatest;

  return {
    fromBlock,
    toBlock,
    safeLatest,
    shouldPoll: fromBlock <= safeLatest,
  };
}

function stableClansman(row: unknown): unknown {
  // Null/non-object guard — fixture rows or malformed lens reads can hand us
  // `null`/`undefined`/primitives, and the legacy projection below would crash
  // on `r.clansman` access. Return the same shape with all-undefined fields so
  // downstream stableJson hashing is deterministic. Per PR #402 gemini CRIT.
  if (row === null || row === undefined || typeof row !== "object") {
    return {
      clansman: {
        clansman: {
          clansmanId: undefined,
          clanId: undefined,
          state: undefined,
          currentRegion: undefined,
          carryWood: undefined,
          carryIron: undefined,
          carryWheat: undefined,
          carryFish: undefined,
        },
        effectiveRegion: undefined,
      },
      activeMission: undefined,
    };
  }
  const r = row as Record<string, unknown>;
  const derived = (r.clansman ?? r) as Record<string, unknown>;
  const cs = (derived.clansman ?? derived) as Record<string, unknown>;
  const mission = (r.activeMission ?? derived.activeMission) as Record<string, unknown> | undefined;
  return {
    clansman: {
      clansman: {
        clansmanId: cs.clansmanId,
        clanId: cs.clanId,
        state: cs.state,
        currentRegion: cs.currentRegion,
        carryWood: cs.carryWood,
        carryIron: cs.carryIron,
        carryWheat: cs.carryWheat,
        carryFish: cs.carryFish,
        // NOTE: intentionally omitting cooldownEndsAtTs, lastMissionNonce — monotonic per-tick,
        // not read by WorldMap, would defeat worldSnapshot delta-check
      },
      effectiveRegion: derived.effectiveRegion,
    },
    // Build activeMission with only defined fields. Convex documents reject
    // arbitrary `undefined` property values; without this filter, an
    // activeMission fixture that omits e.g. `startTick` would materialize
    // `{ startTick: undefined, ... }` via the legacy projection and break
    // serialization on the worldSnapshot insert path. Per pr338-r4 super-
    // swarm codex HIGH.
    activeMission: mission
      ? Object.fromEntries(
          Object.entries({
            active: mission.active,
            action: mission.action,
            startRegion: mission.startRegion,
            targetRegion: mission.targetRegion,
            startTick: mission.startTick,
            arrivalTick: mission.arrivalTick,
            actionStartTick: mission.actionStartTick,
            settlesAtTick: mission.settlesAtTick,
          }).filter(([, value]) => value !== undefined),
        )
      : undefined,
  };
}

export const legacyClansFromClanViews = (clanViews: LegacyClanView[]) =>
  clanViews
    .filter((view) => view.clanId > 0)
    .sort((a, b) => a.clanId - b.clanId)
    .map((view) => ({
      id: String(view.clanId),
      name: `Clan ${view.clanId}`,
      treasury: asString(view.goldBalance),
      goldBalance: asString(view.goldBalance),
      blueprintBalance: asString(view.blueprintBalance),
      vaultWood: asString(view.vaultWood),
      vaultIron: asString(view.vaultIron),
      vaultWheat: asString(view.vaultWheat),
      vaultFish: asString(view.vaultFish),
      baseRegion: asNumber(view.baseRegion),
      baseLevel: asNumber(view.baseLevel),
      wallLevel: asNumber(view.wallLevel),
      monumentLevel: asNumber(view.monumentLevel),
      livingClansmen: asNumber(view.livingClansmen),
      owner: asString(view.owner, ""),
      clansmen: (view.clansmen ?? []).map(stableClansman),
    }));

// M-5: tighten internal-mutation arg shape. We can't enumerate every event
// payload here (the contract emits a wide discriminated union, and the args
// are post-`bigintSafe` arbitrary nested records), but we CAN gate the
// envelope: eventName must be a string, and the metadata fields must match
// the parsed-log shape from viem (bigints from viem.Log.blockNumber are
// passed through; convex serializes them via v.int64()).
const indexerEventValidator = v.object({
  eventName: v.string(),
  // TODO(post-demo): if event union narrows enough, replace v.any with a
  // discriminated union keyed on eventName (M-5 audit).
  args: v.any(),
  address: v.optional(v.string()),
  blockHash: v.optional(v.union(v.string(), v.null())),
  blockNumber: v.optional(
    v.union(v.int64(), v.number(), v.string(), v.null()),
  ),
  transactionHash: v.optional(v.union(v.string(), v.null())),
  transactionIndex: v.optional(v.union(v.number(), v.null())),
  logIndex: v.optional(v.union(v.number(), v.null())),
});

export const ingestEvents = internalMutation({
  args: {
    events: v.array(indexerEventValidator),
    blockNumber: v.number(),
    txHash: v.optional(v.string()),
    firedAtTs: v.optional(v.number()),
    advanceCheckpoint: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    if (resetLocked()) {
      return {
        inserted: 0,
        skipped: args.events.length,
        // Keep the response shape stable for callers that inspect ingest stats.
        rejected: 0,
        resetLocked: true,
      };
    }

    let inserted = 0;
    let rejected = 0;
    for (const raw of args.events) {
      if (!isClanWorldEventName(raw.eventName)) {
        console.warn(
          `[indexer] rejecting unknown eventName "${String(raw.eventName)}"`,
          {
            eventName: raw.eventName,
            txHash: raw.transactionHash ?? args.txHash,
            logIndex: raw.logIndex,
            blockNumber: raw.blockNumber ?? args.blockNumber,
          },
        );
        rejected++;
        continue;
      }

      const event: ParsedIndexerEvent = {
        eventName: raw.eventName,
        args: raw.args,
        address: raw.address,
        blockHash: raw.blockHash,
        blockNumber:
          typeof raw.blockNumber === "string"
            ? Number(raw.blockNumber)
            : raw.blockNumber,
        transactionHash: raw.transactionHash,
        transactionIndex: raw.transactionIndex,
        logIndex: raw.logIndex,
      };
      const logIndex = raw.logIndex ?? 0;
      const txHash = raw.transactionHash ?? args.txHash;
      if (!txHash) continue;
      const blockNumber = asNumber(raw.blockNumber, args.blockNumber);
      const existing = await ctx.db
        .query("chainEvents")
        .withIndex("by_tx_log", (q) =>
          q.eq("txHash", txHash).eq("logIndex", logIndex),
        )
        .first();
      if (existing) continue;

      await ctx.db.insert("chainEvents", {
        txHash,
        logIndex,
        blockNumber,
        eventName: event.eventName,
        args: bigintSafe(event.args),
        decodedAt: Date.now(),
        blockHash: event.blockHash ?? undefined,
        transactionIndex: event.transactionIndex ?? undefined,
        tick:
          eventNumber(event, "tick") ??
          eventNumber(event, "atTick") ??
          eventNumber(event, "openedTick"),
        clanId:
          eventNumber(event, "clanId") ?? eventNumber(event, "targetClanId"),
        clansmanId: eventNumber(event, "clansmanId"),
        banditId: eventNumber(event, "banditId"),
        source: "real-indexer",
      });
      inserted++;

      if (event.eventName === "TickAdvanced") {
        await ctx.db.insert("tickHistory", {
          closedTick: asNumber(event.args.closedTick),
          openedTick: asNumber(event.args.openedTick),
          tickSeed: asString(event.args.tickSeed),
          blockNumber,
          txHash,
          firedAtTs: args.firedAtTs,
          observedAt: Date.now(),
        });
      }

      const pricePoint = pricePointFromEvent(event, blockNumber);
      if (pricePoint) await ctx.db.insert("pricePoint", pricePoint);
    }

    if (args.advanceCheckpoint === true) {
      const checkpoint = await ctx.db.query("eventCheckpoint").first();
      const nextCheckpoint = {
        lastBlock: args.blockNumber,
        lastTxHash: args.txHash,
        lastSeenAt: Date.now(),
      };
      if (checkpoint) {
        if (args.blockNumber >= checkpoint.lastBlock) {
          await ctx.db.patch(checkpoint._id, nextCheckpoint);
        }
      } else {
        await ctx.db.insert("eventCheckpoint", nextCheckpoint);
      }
    }

    return { inserted, rejected };
  },
});

// M-5: tighten the snapshot envelope. Inner contract-read blobs are kept
// as v.any() — they're post-`bigintSafe` arbitrary records that mirror
// dozens of solidity struct fields, and the handler defends with
// `objectAt`/`asNumber`/`asString` coercers anyway.
const snapshotValidator = v.object({
  blockNumber: v.optional(v.number()),
  txHash: v.optional(v.string()),
  // TODO(post-demo): tighten world/market/bandit/clans inner record shapes
  // once contract structs stabilize (M-5 audit).
  world: v.any(),
  market: v.optional(v.any()),
  bandit: v.optional(v.any()),
  clans: v.array(v.any()),
});

export const commitSnapshot = internalMutation({
  args: {
    snapshot: snapshotValidator,
  },
  handler: async (ctx, args) => {
    if (resetLocked()) {
      return {
        tick: 0,
        clans: 0,
        skipped: "reset-locked",
      };
    }

    const snapshot = args.snapshot as SnapshotPayload;
    const now = Date.now();
    const world = snapshot.world;
    const tick = asNumber(world.currentTick);
    const previousWorldSnapshot = await ctx.db
      .query("worldSnapshot")
      .order("desc")
      .first();
    // Fetch tickClock first — it's the always-advancing monotonic cursor.
    // worldSnapshot can freeze between content-change ticks (delta-check), so
    // previousWorldSnapshot.tick is not a reliable stale-gate cursor anymore.
    // tickClock is a single-row table, so .first() (no ordering) is sufficient.
    const tickClockRow = await ctx.db.query("tickClock").first();
    const previousTick = asNumber(tickClockRow?.tick ?? previousWorldSnapshot?.tick, -1);
    const previousBlock = asNumber(tickClockRow?.blockNumber ?? previousWorldSnapshot?.lastUpdatedBlock, -1);
    const incomingBlock = snapshot.blockNumber ?? -1;
    if (
      (tickClockRow || previousWorldSnapshot) &&
      (tick < previousTick ||
        (tick === previousTick && incomingBlock <= previousBlock))
    ) {
      return {
        tick: previousTick,
        clans: snapshot.clans.length,
        skipped: "stale-snapshot",
      };
    }
    // Detect worldPaused transition for the epoch-start refresh below. We
    // recompute the canonical `worldPaused` again at the worldSnapshot
    // construction site (~line 800) — kept in sync intentionally.
    // Per PR #402 Copilot: a same-tick `worldPaused: true → false` transition
    // must reset `tickEpochStartedAt`, otherwise the day/night animation
    // resumes from a stale epoch and overshoots the cycle. We trigger an
    // epoch refresh on ANY worldPaused-state change (true↔false) within the
    // same tick.
    const incomingWorldPaused = asBool(world.worldPaused);
    const previousWorldPaused = previousWorldSnapshot?.worldPaused;
    const worldPausedChanged =
      previousWorldPaused !== undefined &&
      previousWorldPaused !== incomingWorldPaused;
    // Write tickClock on every tick — cheap single-row table (~50 bytes).
    const tickClockData = {
      tick,
      blockNumber: snapshot.blockNumber,
      tickEpochStartedAt:
        tickClockRow?.tick === tick && !worldPausedChanged
          ? tickClockRow.tickEpochStartedAt
          : Math.floor(now / 1000),
      tickEpochDurationMs: Number(HEARTBEAT_INTERVAL_SECONDS) * 1000,
      currentSeasonNumber: asNumber(world.currentSeasonNumber),
      seasonStartTick: asNumber(world.seasonStartTick),
      seasonEndTick: asNumber(world.seasonEndTick),
      winterActive: asBool(world.winterActive),
      winterStartsAtTick: (() => { const wsat = asNumber(world.winterStartsAtTick); return wsat > 0 ? wsat : undefined; })(),
    };
    if (tickClockRow) {
      await ctx.db.patch(tickClockRow._id, tickClockData);
    } else {
      await ctx.db.insert("tickClock", tickClockData);
    }

    if (snapshot.market) {
      const market = snapshot.market;
      const nextMarketState = {
        pools: MARKET_POOL_KEYS.map((resourceType) => {
          const pool = objectAt(market, resourceType);
          return {
            resourceType,
            resourceToken: asString(
              pool.resourceToken,
              "0x0000000000000000000000000000000000000000",
            ),
            reserveResource: asString(pool.resourceReserve),
            reserveGold: asString(pool.goldReserve),
            spotPriceGoldPerResource: asString(pool.spotPriceGoldPerResource),
          };
        }),
        currentTick: asNumber(market.currentTick, tick),
        currentTickQueue: bigintSafe(
          market.currentTickQueue ?? [],
        ) as unknown[],
        nextTickQueue: bigintSafe(market.nextTickQueue ?? []) as unknown[],
        lastUpdatedTick: tick,
        lastUpdatedBlock: snapshot.blockNumber,
        refreshedAt: now,
      };
      const previousMarketState = await ctx.db
        .query("marketState")
        .order("desc")
        .first();
      if (
        !isContentEqualIgnoring(
          previousMarketState,
          nextMarketState,
          MARKET_STATE_NON_CONTENT_FIELDS,
        )
      ) {
        await ctx.db.insert("marketState", nextMarketState);
      }
    }

    if (snapshot.bandit) {
      const bandit = snapshot.bandit;
      const nextBanditView = {
        exists: asBool(bandit.exists),
        id: asNumber(bandit.banditId),
        region: asNumber(bandit.currentRegion),
        state: asNumber(bandit.state),
        attackPower: asNumber(bandit.attackPower),
        tier: asNumber(bandit.tier),
        attemptsMade: asNumber(bandit.attackAttemptsMade),
        maxAttemptsRemaining: asNumber(bandit.maxAttemptsRemaining),
        stateEnteredTick: asNumber(bandit.stateEnteredTick),
        nextActionTick: asNumber(bandit.nextActionTick),
        carryWood: asString(bandit.carryWood),
        carryIron: asString(bandit.carryIron),
        carryWheat: asString(bandit.carryWheat),
        carryFish: asString(bandit.carryFish),
        projectedTargetClanId: asNumber(bandit.projectedTargetClanId),
        projectedTargetLootValue: asString(bandit.projectedTargetLootValue),
        refreshedAt: now,
        lastUpdatedBlock: snapshot.blockNumber,
      };
      const previousBanditView = await ctx.db
        .query("banditView")
        .order("desc")
        .first();
      if (
        !isContentEqualIgnoring(
          previousBanditView,
          nextBanditView,
          BANDIT_VIEW_NON_CONTENT_FIELDS,
        )
      ) {
        await ctx.db.insert("banditView", nextBanditView);
      }
    }

    for (const view of snapshot.clans) {
      const derived = objectAt(view, "clan");
      const clan = objectAt(derived, "clan");
      const clanId = asNumber(clan.clanId);
      if (clanId <= 0) continue;

      const nextView = {
        clanId,
        owner: asString(
          clan.owner,
          "0x0000000000000000000000000000000000000000",
        ),
        baseRegion: asNumber(clan.baseRegion),
        clanState: asNumber(clan.clanState),
        baseLevel: asNumber(clan.baseLevel),
        wallLevel: asNumber(clan.wallLevel),
        monumentLevel: asNumber(clan.monumentLevel),
        livingClansmen: asNumber(clan.livingClansmen),
        isStarving: asBool(derived.isStarving),
        starvationStartsAtTick: asNumber(clan.starvationStartsAtTick),
        coldDamage: asNumber(clan.coldDamage),
        goldBalance: asString(clan.goldBalance),
        blueprintBalance: asString(clan.blueprintBalance),
        vaultWood: asString(clan.vaultWood),
        vaultIron: asString(clan.vaultIron),
        vaultWheat: asString(clan.vaultWheat),
        vaultFish: asString(clan.vaultFish),
        lootValue: asString(derived.lootValue),
        incomingDefenderIds: Array.isArray(view.incomingDefenderIds)
          ? view.incomingDefenderIds.map((id) => asNumber(id))
          : [],
        thisClanDefendingBaseId: asNumber(view.thisClanDefendingBaseId),
        westPlot: bigintSafe(view.westPlot),
        eastPlot: bigintSafe(view.eastPlot),
        clansmen: bigintSafe(view.clansmen ?? []) as unknown[],
        derivedAtTick: asNumber(derived.derivedAtTick, tick),
        refreshedAt: now,
        lastUpdatedBlock: snapshot.blockNumber,
      };

      const previous = await ctx.db
        .query("clanView")
        .withIndex("by_clanId", (q) => q.eq("clanId", clanId))
        .order("desc")
        .first();
      const previousComparable = previous
        ? {
            ...previous,
            _id: undefined,
            _creationTime: undefined,
            refreshedAt: undefined,
            derivedAtTick: undefined,
            lastUpdatedBlock: undefined,
          }
        : undefined;
      if (
        stableJson(previousComparable) !==
        stableJson({ ...nextView, refreshedAt: undefined, derivedAtTick: undefined, lastUpdatedBlock: undefined })
      ) {
        await ctx.db.insert("clanView", nextView);
      }
    }

    const latestClanViews = await Promise.all(
      Array.from(
        { length: MAX_CLANS },
        async (_, index) =>
          await ctx.db
            .query("clanView")
            .withIndex("by_clanId", (q) => q.eq("clanId", index + 1))
            .order("desc")
            .first(),
      ),
    );
    const legacyClans = legacyClansFromClanViews(
      latestClanViews.filter(isPresent),
    );
    // tickEpochStartedAt now sourced from tickClockData (issue #333) — see below.
    // worldPaused / pausedAtTs computation retained from dev for chain-pause semantics.
    // `worldPaused` was already computed as `incomingWorldPaused` upstream for
    // the tickClock epoch-refresh decision; re-alias here for readability.
    const worldPaused = incomingWorldPaused;
    const rawPausedAtTs = asNumber(world.pausedAtTs, Number.NaN);
    const pausedAtTs =
      Number.isFinite(rawPausedAtTs) && (rawPausedAtTs > 0 || worldPaused)
        ? rawPausedAtTs
        : undefined;
    const worldSnapshot = {
      tick,
      tickEpochStartedAt: tickClockData.tickEpochStartedAt,
      tickEpochDurationMs: tickClockData.tickEpochDurationMs,
      currentSeasonNumber: asNumber(world.currentSeasonNumber),
      seasonStartTick: asNumber(world.seasonStartTick),
      seasonEndTick: asNumber(world.seasonEndTick),
      winterActive: asBool(world.winterActive),
      winterStartsAtTick: asNumber(world.winterStartsAtTick),
      winterEndsAtTick: asNumber(world.winterEndsAtTick),
      worldPaused,
      pausedAtTs,
      nextHeartbeatAtTick: asNumber(world.nextHeartbeatAtTick),
      regions: LEGACY_REGIONS,
      clans: legacyClans,
      seasonFinalized: asBool(world.seasonFinalized),
      activeBanditId: asNumber(world.activeBanditId),
      currentTickSeed: asString(world.currentTickSeed),
      lastUpdatedAt: now,
      lastUpdatedBlock: snapshot.blockNumber,
      txHash: snapshot.txHash,
      leaderboard: (Array.isArray(world.leaderboard)
        ? world.leaderboard
        : []
      ).map((entry) => {
        const item = entry as Record<string, unknown>;
        return {
          clanId: asNumber(item.clanId),
          owner: asString(
            item.owner,
            "0x0000000000000000000000000000000000000000",
          ),
          monumentLevel: asNumber(item.monumentLevel),
          baseLevel: asNumber(item.baseLevel),
          wallLevel: asNumber(item.wallLevel),
          livingClansmen: asNumber(item.livingClansmen),
          state: asNumber(item.state),
          lootValue: asString(item.lootValue),
        };
      }),
    };
    // Delta-check: only patch worldSnapshot when data actually changes.
    // Strip audit/timestamp + per-tick-monotonic fields before comparing so a
    // no-data tick is a no-op.
    //
    // IMPORTANT (PR #402 codex P1): `tick` itself is INCLUDED in the comparison.
    // Some web readers (apps/web/src/hooks/useCurrentWorldTick.ts, WorldMap
    // bandit-resolution effect, VaultTab sync label) still source the live tick
    // from `getSnapshot().tick`. If we stripped `tick`, the worldSnapshot row
    // would freeze its tick value between content-change ticks and those
    // readers would report a stale clock. Including `tick` here means every
    // tick advance triggers a patch — which is the correct semantics for those
    // downstream consumers. Migrating all web readers to `getTickClock` is
    // tracked as a follow-up.
    const previousComparableSnapshot = previousWorldSnapshot
      ? (() => {
          const {
            _id, _creationTime, lastUpdatedAt, lastUpdatedBlock, txHash,
            tickEpochStartedAt, tickEpochDurationMs, currentTickSeed, nextHeartbeatAtTick,
            ...rest
          } =
            previousWorldSnapshot as typeof previousWorldSnapshot & {
              _id: unknown;
              _creationTime: unknown;
            };
          void _id; void _creationTime; void lastUpdatedAt; void lastUpdatedBlock; void txHash;
          void tickEpochStartedAt; void tickEpochDurationMs; void currentTickSeed; void nextHeartbeatAtTick;
          return rest;
        })()
      : undefined;
    const nextComparableSnapshot = (() => {
      const {
        lastUpdatedAt, lastUpdatedBlock, txHash,
        tickEpochStartedAt, tickEpochDurationMs, currentTickSeed, nextHeartbeatAtTick,
        ...rest
      } = worldSnapshot;
      void lastUpdatedAt; void lastUpdatedBlock; void txHash;
      void tickEpochStartedAt; void tickEpochDurationMs; void currentTickSeed; void nextHeartbeatAtTick;
      return rest;
    })();
    if (
      stableJson(previousComparableSnapshot) !==
      stableJson(nextComparableSnapshot)
    ) {
      if (previousWorldSnapshot) {
        await ctx.db.patch(previousWorldSnapshot._id, worldSnapshot);
      } else {
        await ctx.db.insert("worldSnapshot", worldSnapshot);
      }
    }

    return { tick, clans: snapshot.clans.length };
  },
});

export const refreshSnapshot = internalAction({
  args: {
    blockNumber: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<unknown> => {
    if (resetLocked()) {
      return { skipped: true, resetLocked: true };
    }

    const client = createClient();
    const address = engineAddress();
    const pinnedBlockNumber =
      args.blockNumber === undefined ? undefined : BigInt(args.blockNumber);
    const blockNumber =
      args.blockNumber ?? Number(await client.getBlockNumber());
    const readLensArgs = <TFunctionName extends LensFunctionName>(
      fn: TFunctionName,
    ) => ({
      address: lensAddress(),
      abi: iClanWorldLensAbi,
      ["functionName"]: fn,
      blockNumber: pinnedBlockNumber,
    });
    const readWorldArgs = <TFunctionName extends ClanWorldFunctionName>(
      fn: TFunctionName,
    ) => ({
      address,
      abi: iClanWorldAbi,
      ["functionName"]: fn,
      blockNumber: pinnedBlockNumber,
    });

    const [worldRaw, market, bandit] = await Promise.all([
      client
        .readContract(readLensArgs(GET_WORLD_SNAPSHOT))
        .catch(() => undefined),
      client.readContract(readLensArgs(GET_MARKET_STATE)).catch(() => undefined),
      client
        .readContract(readLensArgs(GET_ACTIVE_BANDIT_VIEW))
        .catch(() => undefined),
    ]);

    const world = worldRaw as Record<string, unknown> | undefined;
    if (!world) {
      console.warn(
        "[indexer] getWorldSnapshot failed; skipping refresh",
      );
      return { tick: 0, clans: 0 };
    }

    const clanIdsRaw = await client
      .readContract(readWorldArgs(GET_CLAN_IDS))
      .catch(() => undefined);
    const clanIds =
      Array.isArray(clanIdsRaw) && clanIdsRaw.length > 0
        ? clanIdsRaw.map((id) => asNumber(id)).filter((id) => id > 0)
        : Array.from({ length: MAX_CLANS }, (_, index) => index + 1);

    const clans = await Promise.all(
      clanIds.map(async (clanId) => {
        return client
          .readContract({
            ...readLensArgs(GET_CLAN_FULL_VIEW),
            args: [clanId],
          })
          .then((view: unknown) => bigintSafe(view) as Record<string, unknown>)
          .catch(() => undefined);
      }),
    );

    return await ctx.runMutation(indexerApi.commitSnapshot, {
      snapshot: {
        blockNumber,
        world: bigintSafe(world),
        market: bigintSafe(market),
        bandit: bigintSafe(bandit),
        clans: clans.filter(Boolean),
      },
    });
  },
});

export const pollLogs = internalAction({
  args: {},
  handler: async (ctx): Promise<unknown> => {
    if (resetLocked()) {
      return { inserted: 0, skipped: true, resetLocked: true };
    }

    const client = createClient();
    const address = engineAddress();
    const checkpoint = (await ctx.runQuery(indexerApi.readCheckpoint, {})) as {
      lastBlock: number;
      lastTxHash?: string;
      lastSeenAt?: number;
    } | null;
    const latest = await client.getBlockNumber();
    const { fromBlock, toBlock, safeLatest, shouldPoll } = planPollLogRange(
      checkpoint,
      latest,
    );
    if (!shouldPoll) {
      return {
        inserted: 0,
        fromBlock: Number(fromBlock),
        toBlock: Number(safeLatest),
      };
    }

    if (checkpoint?.lastSeenAt && Date.now() - checkpoint.lastSeenAt > 90_000) {
      console.error("[indexer] liveness: pollLogs stalled >90s — cron may be dead");
    }

    const logs = await client.getLogs({ address, fromBlock, toBlock });
    const events = decodeClanWorldLogs(logs);
    const result = await ctx.runMutation(indexerApi.ingestEvents, {
      events,
      blockNumber: Number(toBlock),
      txHash:
        events[events.length - 1]?.transactionHash ?? checkpoint?.lastTxHash,
      advanceCheckpoint: true,
    });
    if ((result as { inserted: number }).inserted > 0) {
      await ctx.scheduler.runAfter(0, indexerApi.refreshSnapshot, {
        blockNumber: Number(toBlock),
      });
    }
    return result;
  },
});

export const readCheckpoint = internalQuery({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("eventCheckpoint").first();
  },
});

/**
 * Demo-day operational reset. Used after redeploying the diamond at a new
 * address to point the indexer at a block just before the new deployment so
 * pollLogs backfills the new diamond's events instead of stale ones.
 */
export const resetCheckpoint = internalMutation({
  args: { lastBlock: v.number() },
  handler: async (ctx, args) => {
    const existing = await ctx.db.query("eventCheckpoint").first();
    if (existing) await ctx.db.delete(existing._id);
    await ctx.db.insert("eventCheckpoint", {
      lastBlock: args.lastBlock,
      lastSeenAt: Date.now(),
    });
    return { lastBlock: args.lastBlock };
  },
});
