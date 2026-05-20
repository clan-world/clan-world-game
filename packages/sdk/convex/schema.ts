import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export const goldQuoteInputFields = {
  tokenMint: v.string(),
  symbol: v.string(),
  name: v.string(),
  usdPrice: v.number(),
  priceChange1h: v.optional(v.number()),
  priceChange6h: v.optional(v.number()),
  priceChange24h: v.optional(v.number()),
  priceChange7d: v.optional(v.number()),
  iconUrl: v.optional(v.string()),
  sourceUpdatedAt: v.optional(v.string()),
};

export const goldQuoteFields = {
  ...goldQuoteInputFields,
  fetchedAt: v.number(),
};

export const kickstartTokenInputFields = {
  tokenMint: v.string(),
  poolAddress: v.string(),
  name: v.string(),
  symbol: v.string(),
  iconUrl: v.optional(v.string()),
  usdPrice: v.number(),
  mcap: v.number(),
  liquidity: v.optional(v.number()),
  volume24h: v.optional(v.number()),
  priceChange1h: v.optional(v.number()),
  priceChange6h: v.optional(v.number()),
  priceChange24h: v.optional(v.number()),
  priceChange7d: v.optional(v.number()),
  rank: v.number(),
  sourceUpdatedAt: v.optional(v.string()),
  sparkline24h: v.optional(
    v.array(v.object({
      price: v.number(),
      open: v.optional(v.number()),
      high: v.optional(v.number()),
      low: v.optional(v.number()),
      close: v.optional(v.number()),
      volume: v.optional(v.number()),
      observedAt: v.number(),
    })),
  ),
};

export const kickstartTokenFields = {
  ...kickstartTokenInputFields,
  fetchedAt: v.number(),
};

export const whisperInputFields = {
  tick: v.number(),
  fromClanId: v.number(),
  toClanIds: v.array(v.number()),
  body: v.string(),
  msgId: v.optional(v.string()),
};

export const whisperFields = {
  ...whisperInputFields,
  timestamp: v.number(),
};

export const orchEventInputFields = {
  tick: v.number(),
  kind: v.union(v.literal("world_event"), v.literal("directive"), v.literal("narration")),
  body: v.string(),
  targetClanId: v.optional(v.number()),
};

export const orchEventFields = {
  ...orchEventInputFields,
  timestamp: v.number(),
};

export const humanSteeringMessageInputFields = {
  tick: v.number(),
  targetClanId: v.number(),
  body: v.string(),
  sentBy: v.optional(v.string()),
};

export const humanSteeringMessageFields = {
  ...humanSteeringMessageInputFields,
  txHash: v.optional(v.string()),
  timestamp: v.number(),
};

export default defineSchema({
  // Single-row table patched every tick — holds tick counter + epoch +
  // season fields for the cheap getTickClock query. See issue #333.
  tickClock: defineTable({
    tick: v.number(),
    blockNumber: v.optional(v.number()),
    tickEpochStartedAt: v.number(),
    tickEpochDurationMs: v.number(),
    currentSeasonNumber: v.optional(v.number()),
    seasonStartTick: v.number(),
    seasonEndTick: v.number(),
    winterActive: v.boolean(),
    winterStartsAtTick: v.optional(v.number()),
  }),
  worldSnapshot: defineTable({
    tick: v.number(),
    tickEpochStartedAt: v.number(),
    tickEpochDurationMs: v.number(),
    // Season + winter timers (Phase 4.4)
    currentSeasonNumber: v.optional(v.number()),
    seasonStartTick: v.optional(v.number()),
    seasonEndTick: v.optional(v.number()),
    winterActive: v.optional(v.boolean()),
    winterStartsAtTick: v.optional(v.number()),
    winterEndsAtTick: v.optional(v.number()),
    worldPaused: v.optional(v.boolean()),
    pausedAtTs: v.optional(v.number()),
    nextHeartbeatAtTick: v.optional(v.number()),
    regions: v.array(
      v.object({
        id: v.string(),
        name: v.string(),
        ownerClanId: v.union(v.string(), v.null()),
      })
    ),
    clans: v.array(
      v.object({
        id: v.string(),
        name: v.string(),
        treasury: v.string(),
        goldBalance: v.optional(v.string()),
        blueprintBalance: v.optional(v.string()),
        vaultWood: v.optional(v.string()),
        vaultIron: v.optional(v.string()),
        vaultWheat: v.optional(v.string()),
        vaultFish: v.optional(v.string()),
        baseRegion: v.optional(v.number()),
        baseLevel: v.optional(v.number()),
        wallLevel: v.optional(v.number()),
        monumentLevel: v.optional(v.number()),
        livingClansmen: v.optional(v.number()),
        owner: v.optional(v.string()),
        clansmen: v.optional(v.array(v.any())),
      })
    ),
    seasonFinalized: v.optional(v.boolean()),
    activeBanditId: v.optional(v.number()),
    currentTickSeed: v.optional(v.string()),
    lastUpdatedAt: v.optional(v.number()),
    lastUpdatedBlock: v.optional(v.number()),
    txHash: v.optional(v.string()),
    leaderboard: v.optional(
      v.array(
        v.object({
          clanId: v.number(),
          owner: v.string(),
          monumentLevel: v.number(),
          baseLevel: v.number(),
          wallLevel: v.number(),
          livingClansmen: v.number(),
          state: v.number(),
          lootValue: v.string(),
        })
      )
    ),
  }).index("by_tick", ["tick"]),
  chainEvents: defineTable({
    txHash: v.string(),
    logIndex: v.number(),
    blockNumber: v.number(),
    eventName: v.string(),
    args: v.any(),
    decodedAt: v.number(),
    blockHash: v.optional(v.string()),
    transactionIndex: v.optional(v.number()),
    tick: v.optional(v.number()),
    clanId: v.optional(v.number()),
    clansmanId: v.optional(v.number()),
    banditId: v.optional(v.number()),
    source: v.optional(v.string()),
  })
    .index("by_tx_log", ["txHash", "logIndex"])
    .index("by_block", ["blockNumber"])
    .index("by_event_block", ["eventName", "blockNumber"])
    .index("by_event_tick", ["eventName", "tick"])
    .index("by_tick", ["tick"])
    .index("by_clan_tick", ["clanId", "tick"]),
  tickHistory: defineTable({
    closedTick: v.number(),
    openedTick: v.number(),
    tickSeed: v.string(),
    blockNumber: v.number(),
    txHash: v.string(),
    firedAtTs: v.optional(v.number()),
    observedAt: v.number(),
  }).index("by_closedTick", ["closedTick"]),
  eventCheckpoint: defineTable({
    lastBlock: v.number(),
    lastTxHash: v.optional(v.string()),
    lastSeenAt: v.number(),
  }),
  clanView: defineTable({
    clanId: v.number(),
    owner: v.string(),
    baseRegion: v.number(),
    clanState: v.number(),
    baseLevel: v.number(),
    wallLevel: v.number(),
    monumentLevel: v.number(),
    livingClansmen: v.number(),
    isStarving: v.boolean(),
    starvationStartsAtTick: v.number(),
    coldDamage: v.number(),
    goldBalance: v.string(),
    blueprintBalance: v.string(),
    vaultWood: v.string(),
    vaultIron: v.string(),
    vaultWheat: v.string(),
    vaultFish: v.string(),
    lootValue: v.string(),
    incomingDefenderIds: v.array(v.number()),
    thisClanDefendingBaseId: v.number(),
    westPlot: v.any(),
    eastPlot: v.any(),
    clansmen: v.array(v.any()),
    derivedAtTick: v.number(),
    refreshedAt: v.number(),
    lastUpdatedBlock: v.optional(v.number()),
  }).index("by_clanId", ["clanId"]),
  marketState: defineTable({
    pools: v.array(
      v.object({
        resourceType: v.string(),
        resourceToken: v.string(),
        reserveResource: v.string(),
        reserveGold: v.string(),
        spotPriceGoldPerResource: v.string(),
      })
    ),
    currentTick: v.number(),
    currentTickQueue: v.array(v.any()),
    nextTickQueue: v.array(v.any()),
    lastUpdatedTick: v.number(),
    lastUpdatedBlock: v.optional(v.number()),
    refreshedAt: v.number(),
  }).index("by_tick", ["currentTick"]),
  banditView: defineTable({
    exists: v.boolean(),
    id: v.number(),
    region: v.number(),
    state: v.number(),
    attackPower: v.number(),
    tier: v.number(),
    attemptsMade: v.number(),
    maxAttemptsRemaining: v.number(),
    stateEnteredTick: v.number(),
    nextActionTick: v.number(),
    carryWood: v.string(),
    carryIron: v.string(),
    carryWheat: v.string(),
    carryFish: v.string(),
    projectedTargetClanId: v.number(),
    projectedTargetLootValue: v.string(),
    refreshedAt: v.number(),
    lastUpdatedBlock: v.optional(v.number()),
  }).index("by_bandit_id", ["id"]),
  pricePoint: defineTable({
    tick: v.number(),
    resourceType: v.string(),
    priceWoodGold: v.string(),
    blockNumber: v.optional(v.number()),
    observedAt: v.number(),
  })
    .index("by_tick", ["tick"])
    .index("by_resource_tick", ["resourceType", "tick"]),
  goldQuote: defineTable(goldQuoteFields).index("by_token", ["tokenMint"]),
  goldQuoteSample: defineTable({
    tokenMint: v.string(),
    usdPrice: v.number(),
    observedAt: v.number(),
  }).index("by_token_observed", ["tokenMint", "observedAt"]),
  goldTxReceipts: defineTable({
    signature: v.string(),
    owner: v.string(),
    clanId: v.number(),
    action: v.union(v.literal("whisper"), v.literal("doctrine")),
    burnAmount: v.number(),
    skipTax: v.number(),
    memo: v.string(),
    observedAt: v.number(),
  }).index("by_signature", ["signature"]),
  kickstartTokens: defineTable(kickstartTokenFields)
    .index("by_token", ["tokenMint"])
    .index("by_rank", ["rank"]),
  kickstartWatchedTokens: defineTable({
    tokenMint: v.string(),
    watchedAt: v.number(),
  }).index("by_token", ["tokenMint"]),
  agentLogs: defineTable({
    level: v.union(v.literal("info"), v.literal("warn"), v.literal("error")),
    message: v.string(),
    timestamp: v.number(),
  }),
  inftTokens: defineTable({
    tokenId: v.number(),
    clanId: v.number(),
    owner: v.string(),
    dataHash: v.string(),
    encryptedKeyHash: v.optional(v.string()),
    metadataUri: v.optional(v.string()),
    updatedAt: v.number(),
    txHash: v.optional(v.string()),
  }).index("by_tokenId", ["tokenId"]),
  inftTransfers: defineTable({
    tokenId: v.number(),
    clanId: v.number(),
    from: v.string(),
    to: v.string(),
    dataHash: v.string(),
    encryptedKeyHash: v.string(),
    txHash: v.string(),
    transferredAt: v.number(),
  })
    .index("by_tokenId", ["tokenId"])
    .index("by_clanId", ["clanId"]),
  memoryEntries: defineTable({
    clanId: v.number(),
    key: v.string(),
    value: v.string(),
    dataHash: v.optional(v.string()),
    source: v.union(v.literal("local"), v.literal("0g"), v.literal("demo")),
    updatedAt: v.number(),
    txHash: v.optional(v.string()),
  })
    .index("by_clan_key", ["clanId", "key"])
    .index("by_clan", ["clanId"]),
  bulletins: defineTable({
    clanId: v.number(),
    slot: v.number(),
    body: v.string(),
    updatedAt: v.number(),
    dataHash: v.optional(v.string()),
    txHash: v.optional(v.string()),
  }).index("by_clan_slot", ["clanId", "slot"]),
  /**
   * Append-only audit log of reads/writes on memoryEntries keys. Surfaced
   * as the cockpit "memory CRUD" section on the ZeroG tab. One row per
   * tick operation; `note` is an optional human-readable description.
   */
  memoryEvents: defineTable({
    tick: v.number(),
    clanId: v.number(),
    op: v.union(v.literal("read"), v.literal("write")),
    key: v.string(),
    note: v.optional(v.string()),
    timestamp: v.number(),
  })
    .index("by_clan_tick", ["clanId", "tick"])
    .index("by_tick", ["tick"]),
  // Comms-tab tables (added 2026-05-04 for cockpit Comms wiring).
  // These three feed the per-elder "AXL" view; bulletins (above) feeds the
  // "0G Bulletin" view + the cross-clan flyout.

  /** AXL direct whispers between clans. Recorded by elder CLI via Convex. */
  whispers: defineTable(whisperFields)
    .index("by_tick", ["tick"])
    .index("by_from_clan", ["fromClanId", "tick"])
    .index("by_from_clan_tick_msgid", ["fromClanId", "tick", "msgId"]),

  /** Orchestrator-emitted world events surfaced to the cockpit Comms tab. */
  orchEvents: defineTable(orchEventFields)
    .index("by_tick", ["tick"])
    .index("by_target_clan", ["targetClanId", "tick"]),

  /** Human ("iNFT Owner") steering messages routed to a specific clan. */
  humanSteeringMessages: defineTable(humanSteeringMessageFields)
    .index("by_target_clan", ["targetClanId", "tick"])
    .index("by_tick", ["tick"]),
});
