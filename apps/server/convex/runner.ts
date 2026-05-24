import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import {
  HEARTBEAT_INTERVAL_SECONDS,
  SEASON_DURATION_TICKS,
  WINTER_DURATION_TICKS,
  WINTER_PERIOD_TICKS,
  WINTER_START_TICK,
} from "@clan-world/shared/generated/constants";

const VALID_ELDER_IDS = ["elder-1", "elder-2", "elder-3", "elder-4"] as const;
const EVENT_FETCH_LIMIT = 50;
const PENDING_FETCH_LIMIT = 25;
const UID_SCAN_LIMIT = 5000;

const elderIdValidator = v.union(
  v.literal("elder-1"),
  v.literal("elder-2"),
  v.literal("elder-3"),
  v.literal("elder-4"),
);

const resetReasonValidator = v.union(
  v.literal("scheduled"),
  v.literal("manual"),
  v.literal("memory_wipe_gap"),
  v.literal("late_join"),
);

const runnerEventKindValidator = v.union(
  v.literal("hook_failure"),
  v.literal("convex_outage_recovery"),
  v.literal("settings_drift_panic"),
  v.literal("invariant_violation"),
  v.literal("ready_probe_timeout"),
);

function assertKnownElder(elderId: string): void {
  if (!VALID_ELDER_IDS.includes(elderId as (typeof VALID_ELDER_IDS)[number])) {
    throw new Error(`unknown elderId: ${elderId}`);
  }
}

function memoryWipeTickInterval(): number {
  const configured = process.env.CLAN_WORLD_MEMORY_WIPE_TICK_INTERVAL;
  if (configured) {
    const parsed = Number(configured);
    if (Number.isFinite(parsed) && parsed > 0) return Math.floor(parsed);
  }
  // TODO(future): source from contract/settings table when runtime settings exist.
  return 50;
}

function gameSettings(clock?: { heartbeatIntervalSeconds?: number } | null) {
  return {
    heartbeatIntervalSeconds:
      clock?.heartbeatIntervalSeconds ?? Number(HEARTBEAT_INTERVAL_SECONDS),
    memoryWipeTickInterval: memoryWipeTickInterval(),
    winterStartTick: Number(WINTER_START_TICK),
    winterDurationTicks: Number(WINTER_DURATION_TICKS),
    winterPeriodTicks: Number(WINTER_PERIOD_TICKS),
    seasonDurationTicks: Number(SEASON_DURATION_TICKS),
    contractAddress: process.env.CLAN_WORLD_CONTRACT_ADDRESS ?? "",
  };
}

async function latestClock(ctx: { db: any }) {
  const clock = await ctx.db.query("tickClock").order("desc").first();
  if (clock) return clock;
  return {
    tick: 0,
    tickEpochStartedAt: 0,
    tickEpochDurationMs: Number(HEARTBEAT_INTERVAL_SECONDS) * 1000,
    heartbeatIntervalSeconds: Number(HEARTBEAT_INTERVAL_SECONDS),
    seasonStartTick: 0,
    seasonEndTick: Number(SEASON_DURATION_TICKS),
    winterActive: false,
    winterStartsAtTick: Number(WINTER_START_TICK),
  };
}

async function latestReceivedTick(ctx: { db: any }, elderId: string): Promise<number | null> {
  const rows = await ctx.db
    .query("tickReceiveLog")
    .withIndex("by_elder_received", (q: any) => q.eq("elderId", elderId))
    .order("desc")
    .take(200);
  const tickRows = rows.filter((row: any) => typeof row.tickNumber === "number");
  if (tickRows.length === 0) return null;
  return Math.max(...tickRows.map((row: any) => row.tickNumber));
}

export const getRunnerStartupState = query({
  args: { elderId: elderIdValidator },
  handler: async (ctx, { elderId }) => {
    assertKnownElder(elderId);
    const clock = await latestClock(ctx);
    const lastReceivedTick = await latestReceivedTick(ctx, elderId);
    const sentForCurrentTick =
      (await ctx.db
        .query("tickSendLog")
        .withIndex("by_elder_tick", (q) =>
          q.eq("elderId", elderId).eq("tickNumber", clock.tick),
        )
        .first()) !== null;

    return {
      tickClock: clock,
      gameSettings: gameSettings(clock),
      lastReceivedTick,
      sentForCurrentTick,
    };
  },
});

export const getRunnerAuxiliary = query({
  args: { elderId: elderIdValidator },
  handler: async (ctx, { elderId }) => {
    assertKnownElder(elderId);
    const clock = await latestClock(ctx);
    const snapshot = await ctx.db.query("worldSnapshot").order("desc").first();
    const activeBanditId =
      typeof snapshot?.activeBanditId === "number" && snapshot.activeBanditId > 0
        ? snapshot.activeBanditId
        : undefined;
    const banditView =
      activeBanditId === undefined
        ? null
        : await ctx.db
          .query("banditView")
          .withIndex("by_bandit_id", (q) => q.eq("id", activeBanditId))
          .order("desc")
          .first();

    const chainEvents = await ctx.db
      .query("chainEvents")
      .withIndex("by_tick", (q) => q.eq("tick", clock.tick))
      .order("desc")
      .take(EVENT_FETCH_LIMIT);

    const pendingMessages = await ctx.db
      .query("pendingMessages")
      .withIndex("by_target_unconsumed", (q) =>
        q.eq("targetElderId", elderId).eq("consumedAt", undefined),
      )
      .order("asc")
      .take(PENDING_FETCH_LIMIT);

    return {
      tickClock: clock,
      gameSettings: gameSettings(clock),
      banditView,
      chainEvents,
      pendingMessages,
    };
  },
});

export const hasTickReceive = query({
  args: { elderId: elderIdValidator, tickNumber: v.number() },
  handler: async (ctx, { elderId, tickNumber }) => {
    assertKnownElder(elderId);
    return (
      (await ctx.db
        .query("tickReceiveLog")
        .withIndex("by_elder_tick", (q) =>
          q.eq("elderId", elderId).eq("tickNumber", tickNumber),
        )
        .first()) !== null
    );
  },
});

export const isThematicUidTaken = query({
  args: { uid: v.string() },
  handler: async (ctx, { uid }) => {
    const rows = await ctx.db.query("tickReceiveLog").order("desc").take(UID_SCAN_LIMIT);
    return rows.some((row) => row.whisperUid === uid || row.specialMsgUid === uid);
  },
});

export const hasMessageUidReceive = query({
  args: { uid: v.string() },
  handler: async (ctx, { uid }) => {
    const rows = await ctx.db.query("tickReceiveLog").order("desc").take(UID_SCAN_LIMIT);
    return rows.some((row) => row.whisperUid === uid || row.specialMsgUid === uid);
  },
});

export const recordTickSend = mutation({
  args: {
    elderId: elderIdValidator,
    tickNumber: v.number(),
    messageHash: v.string(),
    resetMetadata: v.optional(v.object({
      resetTick: v.number(),
      resetReason: resetReasonValidator,
      resetEventId: v.id("resetEventLog"),
    })),
  },
  handler: async (ctx, args) => {
    assertKnownElder(args.elderId);
    return await ctx.db.insert("tickSendLog", {
      elderId: args.elderId,
      tickNumber: args.tickNumber,
      sentAt: Date.now(),
      messageHash: args.messageHash,
      ...(args.resetMetadata ? { resetMetadata: args.resetMetadata } : {}),
    });
  },
});

export const consumePendingMessages = mutation({
  args: {
    messageIds: v.array(v.id("pendingMessages")),
    consumedAt: v.number(),
  },
  handler: async (ctx, { messageIds, consumedAt }) => {
    for (const id of messageIds) {
      await ctx.db.patch(id, { consumedAt });
    }
  },
});

export const recordResetEvent = mutation({
  args: {
    elderId: elderIdValidator,
    resetTick: v.number(),
    reason: resetReasonValidator,
  },
  handler: async (ctx, { elderId, resetTick, reason }) => {
    assertKnownElder(elderId);
    return await ctx.db.insert("resetEventLog", {
      elderId,
      resetTick,
      reason,
      startedAt: Date.now(),
    });
  },
});

export const completeResetEvent = mutation({
  args: { resetEventId: v.id("resetEventLog") },
  handler: async (ctx, { resetEventId }) => {
    await ctx.db.patch(resetEventId, { completedAt: Date.now() });
  },
});

export const recordRunnerEvent = mutation({
  args: {
    elderId: elderIdValidator,
    kind: runnerEventKindValidator,
    message: v.string(),
  },
  handler: async (ctx, { elderId, kind, message }) => {
    assertKnownElder(elderId);
    await ctx.db.insert("runnerEvents", {
      elderId,
      kind,
      message,
      at: Date.now(),
    });
  },
});
