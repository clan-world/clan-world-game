import { mutation } from "./_generated/server";
import { v } from "convex/values";
import { requireIndexerSecret } from "./authShared";

const RESET_TABLES = [
  "worldSnapshot",
  "chainEvents",
  "tickHistory",
  "eventCheckpoint",
  "clanView",
  "marketState",
  "banditView",
  "pricePoint",
  "goldQuote",
  "goldQuoteSample",
  "goldTxReceipts",
  "kickstartTokens",
  "kickstartWatchedTokens",
  "agentLogs",
  "inftTokens",
  "inftTransfers",
  "memoryEntries",
  "bulletins",
  "memoryEvents",
  "whispers",
  "orchEvents",
  "humanSteeringMessages",
  "runnerStatus",
] as const;

const MAX_FLUSH_WRITES = 9000;

export const flushGameState = mutation({
  args: {
    secret: v.string(),
    batchSize: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    requireIndexerSecret(args.secret);

    const batchSize = Math.max(1, Math.min(args.batchSize ?? 100, 400));
    const deletedByTable: Record<string, number> = {};
    let totalDeleted = 0;

    for (const table of RESET_TABLES) {
      if (totalDeleted >= MAX_FLUSH_WRITES) {
        break;
      }

      const remainingWrites = MAX_FLUSH_WRITES - totalDeleted;
      const rows = await ctx.db.query(table).take(Math.min(batchSize, remainingWrites));
      deletedByTable[table] = rows.length;
      totalDeleted += rows.length;
      for (const row of rows) {
        await ctx.db.delete(row._id);
      }
    }

    const complete =
      totalDeleted < MAX_FLUSH_WRITES &&
      (await Promise.all(RESET_TABLES.map((table) => ctx.db.query(table).take(1)))).every(
        (rows) => rows.length === 0,
      );

    return {
      deletedByTable,
      totalDeleted,
      batchSize,
      deletedAny: totalDeleted > 0,
      complete,
    };
  },
});

export const flushClanViewForClan = mutation({
  args: {
    secret: v.string(),
    clanId: v.number(),
    batchSize: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    requireIndexerSecret(args.secret);

    const batchSize = Math.max(1, Math.min(args.batchSize ?? 100, 500));
    const rows = await ctx.db
      .query("clanView")
      .withIndex("by_clanId", (q) => q.eq("clanId", args.clanId))
      .take(batchSize);

    for (const row of rows) {
      await ctx.db.delete(row._id);
    }

    return {
      clanId: args.clanId,
      deleted: rows.length,
      batchSize,
      complete: rows.length === 0,
    };
  },
});

export const resetCheckpoint = mutation({
  args: {
    secret: v.string(),
    lastBlock: v.number(),
  },
  handler: async (ctx, args) => {
    requireIndexerSecret(args.secret);

    const existing = await ctx.db.query("eventCheckpoint").order("desc").first();
    if (existing) {
      await ctx.db.delete(existing._id);
    }

    await ctx.db.insert("eventCheckpoint", {
      lastBlock: args.lastBlock,
      lastSeenAt: Date.now(),
    });

    return { lastBlock: args.lastBlock };
  },
});
