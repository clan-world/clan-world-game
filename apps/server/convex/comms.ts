import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { requireIndexerSecret } from "./authShared";
import { humanSteeringMessageInputFields, orchEventInputFields, whisperInputFields } from "./schema";

/**
 * Combined Comms feed for one clan's private view.
 *
 * Joins three sources into a single tick-ordered list:
 *   - whispers WHERE fromClanId = clanId OR clanId IN toClanIds
 *   - orchEvents WHERE targetClanId = clanId OR targetClanId is null (broadcast)
 *   - humanSteeringMessages WHERE targetClanId = clanId
 *
 * Returned newest-tick-first, capped at the requested limit.
 */
export const getCombinedComms = query({
  args: {
    clanId: v.number(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { clanId, limit }) => {
    const cap = limit ?? 40;

    // Whispers: this clan sent OR was a recipient.
    const sentByMe = await ctx.db
      .query("whispers")
      .withIndex("by_from_clan", q => q.eq("fromClanId", clanId))
      .order("desc")
      .take(cap);
    const allRecent = await ctx.db.query("whispers").order("desc").take(cap * 2);
    const receivedByMe = allRecent.filter(w => w.fromClanId !== clanId && w.toClanIds.includes(clanId));
    const whispers = [...sentByMe, ...receivedByMe].map(w => ({
      kind: "whisper" as const,
      tick: w.tick,
      speaker: `clan-${w.fromClanId}`,
      body: w.body,
      recipients: w.fromClanId === clanId ? w.toClanIds : undefined,
      timestamp: w.timestamp,
    }));

    // ORCH events: targeted at this clan OR global broadcast.
    const targeted = await ctx.db
      .query("orchEvents")
      .withIndex("by_target_clan", q => q.eq("targetClanId", clanId))
      .order("desc")
      .take(cap);
    const recentOrch = await ctx.db.query("orchEvents").order("desc").take(cap * 2);
    const broadcasts = recentOrch.filter(o => o.targetClanId === undefined);
    const orchs = [...targeted, ...broadcasts].map(o => ({
      kind: "orch" as const,
      tick: o.tick,
      speaker: "orchestrator",
      body: o.body,
      timestamp: o.timestamp,
    }));

    // Human steering messages: targeted at this clan.
    const humanMsgs = await ctx.db
      .query("humanSteeringMessages")
      .withIndex("by_target_clan", q => q.eq("targetClanId", clanId))
      .order("desc")
      .take(cap);
    const humans = humanMsgs.map(h => ({
      kind: "human" as const,
      tick: h.tick,
      speaker: "Owner",
      body: h.body,
      timestamp: h.timestamp,
    }));

    // Merge + sort newest-first by tick (then by timestamp for ties).
    const merged = [...whispers, ...orchs, ...humans];
    merged.sort((a, b) => b.tick - a.tick || b.timestamp - a.timestamp);
    return merged.slice(0, cap);
  },
});

// Public seed mutations — gated by INDEXER_SECRET (fail-closed if unset on the
// Convex deployment). Used by mock.ts for local-Convex testing AND by the
// orchestrator process for live cockpit Comms feed writes via IConvexClient.
// Idempotent: callers re-invoke at will. Schema validation prevents bad data
// but ALONE is not sufficient — without the secret gate, anyone with the
// deployment URL could deface the cockpit-visible feed.

export const sendWhisper = mutation({
  args: {
    secret: v.string(),
    ...whisperInputFields,
  },
  handler: async (ctx, args) => {
    requireIndexerSecret(args.secret);
    if (args.msgId) {
      const existing = await ctx.db
        .query("whispers")
        .withIndex("by_from_clan_tick_msgid", q =>
          q.eq("fromClanId", args.fromClanId).eq("tick", args.tick).eq("msgId", args.msgId))
        .first();
      if (existing) return;
    }
    const { secret: _omit, ...row } = args;
    await ctx.db.insert("whispers", { ...row, timestamp: Date.now() });
  },
});

export const seedOrchEvent = mutation({
  args: {
    secret: v.string(),
    ...orchEventInputFields,
  },
  handler: async (ctx, args) => {
    requireIndexerSecret(args.secret);
    const { secret: _omit, ...row } = args;
    await ctx.db.insert("orchEvents", { ...row, timestamp: Date.now() });
  },
});

export const seedHumanSteering = mutation({
  args: {
    secret: v.string(),
    ...humanSteeringMessageInputFields,
  },
  handler: async (ctx, args) => {
    requireIndexerSecret(args.secret);
    const { secret: _omit, ...row } = args;
    await ctx.db.insert("humanSteeringMessages", { ...row, timestamp: Date.now() });
  },
});
