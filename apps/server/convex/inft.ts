import { mutation } from "./_generated/server";
import { v } from "convex/values";

/**
 * Mirror mutations require INDEXER_SECRET to match the Convex env var of the
 * same name — set this on the Convex dashboard. Indexers/scripts pass it in
 * the `secret` arg. If INDEXER_SECRET is unset on the deployment, mutations
 * reject all writes (fail-closed). Demo Convex dashboards must set this before
 * the indexer ships.
 */
function requireIndexerSecret(supplied: string): void {
  const expected = process.env.INDEXER_SECRET;
  if (!expected) {
    throw new Error("INDEXER_SECRET is not configured on this Convex deployment");
  }
  if (supplied !== expected) {
    throw new Error("invalid indexer secret");
  }
}

export const mirrorMemoryEntry = mutation({
  args: {
    secret: v.string(),
    clanId: v.number(),
    key: v.string(),
    value: v.string(),
    dataHash: v.optional(v.string()),
    // "0g" retained for historical rows (deploy-safety); see schema.ts.
    source: v.union(v.literal("local"), v.literal("0g"), v.literal("demo")),
    txHash: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    requireIndexerSecret(args.secret);
    const { secret: _omit, ...row } = args;
    const existing = await ctx.db
      .query("memoryEntries")
      .withIndex("by_clan_key", (q) => q.eq("clanId", row.clanId).eq("key", row.key))
      .first();
    const stamped = { ...row, updatedAt: Date.now() };
    if (existing) {
      await ctx.db.patch(existing._id, stamped);
      return existing._id;
    }
    return await ctx.db.insert("memoryEntries", stamped);
  },
});

export const mirrorBulletin = mutation({
  args: {
    secret: v.string(),
    clanId: v.number(),
    slot: v.number(),
    body: v.string(),
    dataHash: v.optional(v.string()),
    txHash: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    requireIndexerSecret(args.secret);
    const { secret: _omit, ...row } = args;
    const existing = await ctx.db
      .query("bulletins")
      .withIndex("by_clan_slot", (q) => q.eq("clanId", row.clanId).eq("slot", row.slot))
      .first();
    const stamped = { ...row, updatedAt: Date.now() };
    if (existing) {
      await ctx.db.patch(existing._id, stamped);
      return existing._id;
    }
    return await ctx.db.insert("bulletins", stamped);
  },
});
