import { query, internalMutation } from "./_generated/server";
import { v } from "convex/values";

/**
 * Memory query/mutation layer for the cockpit Agent tab.
 *
 * Two surfaces:
 *
 *   1. memoryEntries — long-term KV store the elder agent has written. Already
 *      written by mirror mutations and seeded below. The cockpit KV section
 *      reads this newest-first.
 *
 *   2. memoryEvents — append-only audit log of read/write hits on those keys,
 *      surfaced as the cockpit memory CRUD section. Each event is one tick
 *      operation; the tick number is the foreign key into world time. New
 *      table introduced in this PR (see schema.ts).
 *
 * Both surfaces follow the same demo discipline as comms.ts / bulletins.ts:
 * a `getByClan` query for cockpit reads and a `seed*` mutation for local
 * dev so the demo always has data even on a cold backend.
 */

// ─── memoryEntries (KV state) ─────────────────────────────────────────────

export const getByClan = query({
  args: {
    clanId: v.number(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { clanId, limit }) => {
    return await ctx.db
      .query("memoryEntries")
      .withIndex("by_clan", q => q.eq("clanId", clanId))
      .order("desc")
      .take(limit ?? 20);
  },
});

export const seedEntry = internalMutation({
  args: {
    clanId: v.number(),
    key: v.string(),
    value: v.string(),
    source: v.optional(v.union(v.literal("local"), v.literal("0g"), v.literal("demo"))),
    dataHash: v.optional(v.string()),
    txHash: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("memoryEntries")
      .withIndex("by_clan_key", q => q.eq("clanId", args.clanId).eq("key", args.key))
      .first();
    const stamped = {
      clanId: args.clanId,
      key: args.key,
      value: args.value,
      source: args.source ?? ("demo" as const),
      dataHash: args.dataHash,
      txHash: args.txHash,
      updatedAt: Date.now(),
    };
    if (existing) {
      await ctx.db.patch(existing._id, stamped);
      return existing._id;
    }
    return await ctx.db.insert("memoryEntries", stamped);
  },
});

// ─── memoryEvents (CRUD log) ──────────────────────────────────────────────

export const getEventsByClan = query({
  args: {
    clanId: v.number(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { clanId, limit }) => {
    return await ctx.db
      .query("memoryEvents")
      .withIndex("by_clan_tick", q => q.eq("clanId", clanId))
      .order("desc")
      .take(limit ?? 20);
  },
});

export const seedEvent = internalMutation({
  args: {
    tick: v.number(),
    clanId: v.number(),
    op: v.union(v.literal("read"), v.literal("write")),
    key: v.string(),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("memoryEvents", {
      ...args,
      timestamp: Date.now(),
    });
  },
});
