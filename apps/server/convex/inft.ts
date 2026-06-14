import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

/**
 * COMPAT SHIM — pending mobile migration.
 *
 * The 0G/iNFT strip (#657) removed the `inftTokens` / `inftTransfers` tables and
 * dropped this query. The Android app (apps/clan-world-mobile) still calls
 * `inft:getInftDemoState` from InftDetailViewModel / HallViewModel /
 * StrategyEditorViewModel, so removing the query makes those Convex calls 500.
 *
 * This shim restores the query with the SAME response shape the mobile client
 * deserializes ({ token, transfers, memory, bulletins }). Because the iNFT
 * tables are gone, `token` is always null and `transfers` is always empty —
 * which is exactly what the Kotlin model already tolerates (InftDemoState.token
 * is nullable, transfers defaults to emptyList). The live `memory` + `bulletins`
 * data is still served from the surviving tables, so the mobile memory/bulletin
 * panels keep working. Remove this shim once mobile stops calling it.
 */
export const getInftDemoState = query({
  args: { clanId: v.number() },
  handler: async (ctx, { clanId }) => {
    const memory = await ctx.db
      .query("memoryEntries")
      .withIndex("by_clan", (q) => q.eq("clanId", clanId))
      .order("desc")
      .take(20);
    const bulletins = await ctx.db
      .query("bulletins")
      .withIndex("by_clan_slot", (q) => q.eq("clanId", clanId))
      .order("desc")
      .take(8);

    // token/transfers came from the now-removed iNFT tables; return the
    // empty/null defaults the mobile model already expects.
    return { token: null, transfers: [], memory, bulletins };
  },
});

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
    // "walrus" = mirrored after a successful Walrus Memory KV save.
    source: v.union(
      v.literal("local"),
      v.literal("0g"),
      v.literal("demo"),
      v.literal("walrus"),
    ),
    txHash: v.optional(v.string()),
    // Walrus provenance for the cockpit ProofChip — see schema.ts. Optional so
    // non-Walrus mirror callers can omit them; persisted only when provided.
    blobId: v.optional(v.string()),
    accountId: v.optional(v.string()),
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
