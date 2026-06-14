import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { requireIndexerSecret } from "./authShared";

/**
 * Bulletins query layer. This file adds the cockpit-side queries plus a seed
 * mutation for local testing.
 *
 * Slot semantics: each clan gets a bounded ring of bulletin slots. `slot`
 * monotonically increments with each post; `updatedAt` is the wall-clock
 * timestamp the post was last touched. Visibility (visible vs. old/hidden)
 * is computed client-side from the current tick + a TTL window.
 */

export const getByClan = query({
  args: {
    clanId: v.number(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { clanId, limit }) => {
    return await ctx.db
      .query("bulletins")
      .withIndex("by_clan_slot", q => q.eq("clanId", clanId))
      .order("desc")
      .take(limit ?? 20);
  },
});

export const getAll = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { limit }) => {
    // For the cross-clan flyout: every clan's bulletins, newest-slot first.
    return await ctx.db.query("bulletins").order("desc").take(limit ?? 60);
  },
});

// Public seed mutation — gated by INDEXER_SECRET (fail-closed if unset on the
// Convex deployment). The orchestrator process supplies the secret via
// IConvexClient.postBulletin → set INDEXER_SECRET in the orchestrator env to
// match Convex's INDEXER_SECRET.
export const seedBulletin = mutation({
  args: {
    secret: v.string(),
    clanId: v.number(),
    slot: v.number(),
    body: v.string(),
    // Optional provenance from the on-chain bulletin write — surfaced on
    // the cockpit. Both fields are also optional in the bulletins table
    // schema so older rows without them stay valid.
    dataHash: v.optional(v.string()),
    txHash: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    requireIndexerSecret(args.secret);
    const { secret: _omit, ...row } = args;
    await ctx.db.insert("bulletins", {
      ...row,
      updatedAt: Date.now(),
    });
  },
});
