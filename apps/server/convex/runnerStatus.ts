import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requireIndexerSecret } from "./authShared";

const resultValidator = v.union(
  v.literal("success"),
  v.literal("revert"),
  v.literal("timeout"),
  v.literal("error"),
  v.literal("rate-limited"),
  v.literal("boot-error"),
);

export const getRunnerStatus = query({
  args: {
    secret: v.string(),
    runnerId: v.optional(v.string()),
  },
  handler: async (ctx, { secret, runnerId }) => {
    requireIndexerSecret(secret);

    if (runnerId) {
      return await ctx.db
        .query("runnerStatus")
        .withIndex("by_runnerId", (q) => q.eq("runnerId", runnerId))
        .order("desc")
        .first();
    }
    // Cap unbounded fan-out at 50 rows — defensive against regression that
    // re-introduces per-insert appends (today updateRunnerStatus patches in
    // place so we see ~4 rows, one per Elder). opus 4.7 R3 L3.
    return await ctx.db.query("runnerStatus").order("desc").take(50);
  },
});

export const updateRunnerStatus = mutation({
  args: {
    secret: v.string(),
    runnerId: v.string(),
    lastFireAt: v.optional(v.number()),
    lastFireResult: resultValidator,
    lastFailureMessage: v.optional(v.string()),
    heartbeatIntervalSeconds: v.optional(v.number()),
    nextHeartbeatAtTs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    requireIndexerSecret(args.secret);

    const existing = await ctx.db
      .query("runnerStatus")
      .withIndex("by_runnerId", (q) => q.eq("runnerId", args.runnerId))
      .order("desc")
      .first();

    const row = {
      runnerId: args.runnerId,
      ...(args.lastFireAt !== undefined ? { lastFireAt: args.lastFireAt } : {}),
      lastFireResult: args.lastFireResult,
      ...(args.lastFailureMessage !== undefined
        ? { lastFailureMessage: args.lastFailureMessage }
        : {}),
      ...(args.heartbeatIntervalSeconds !== undefined
        ? { heartbeatIntervalSeconds: args.heartbeatIntervalSeconds }
        : {}),
      ...(args.nextHeartbeatAtTs !== undefined
        ? { nextHeartbeatAtTs: args.nextHeartbeatAtTs }
        : {}),
      updatedAt: Date.now(),
    };

    if (existing) {
      await ctx.db.patch(existing._id, row);
      return existing._id;
    }
    return await ctx.db.insert("runnerStatus", row);
  },
});
