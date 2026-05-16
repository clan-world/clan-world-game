import { v } from "convex/values";
import { query } from "./_generated/server";

// Battle / resolution event names. Used by `getBattleEvents` to filter the
// chainEvents stream down to just combat-relevant events the WorldMap consumes
// for its combat vignette playback. Kept in one place so the next person who
// adds a battle-relevant event remembers to update this set.
//
// Today WorldMap only acts on `BanditAttackResolved`, but the wider cluster
// (defeated / target died / wall damaged / clansman killed / loot / blueprint)
// is included so future battle-feed consumers don't need a schema change.
export const BATTLE_EVENT_NAMES = [
  "BanditAttackResolved",
  "BanditDefeated",
  "BanditTargetDied",
  "BanditEscaped",
  "BanditStateChanged",
  "WallDamagedByBandit",
  "ClansmanKilledByBandit",
  "LootDistributed",
  "LootDistributedToDefender",
  "BlueprintAwarded",
  "BlueprintEarned",
] as const;

const BATTLE_EVENT_NAME_SET: ReadonlySet<string> = new Set<string>(
  BATTLE_EVENT_NAMES,
);

/**
 * @deprecated Subscribe to {@link getEventTickerFeed} (UI ticker) or
 *   {@link getBattleEvents} (combat vignette) instead. Returning the last 60
 *   raw events on every chainEvents insert pushes ~36 KB × N-clients per tick
 *   to every subscriber — see issue #336 / parent #332.
 *
 * Kept as a back-compat wrapper for one release. Remove in a follow-up issue
 * once all clients have rolled over.
 */
export const getRecentChainEvents = query({
  handler: async (ctx) => {
    return await ctx.db.query("chainEvents").order("desc").take(60);
  },
});

/**
 * Returns the most recent `limit` chainEvents, ordered newest-first. Used by
 * the UI ticker scroll (apps/web/src/EventTicker.tsx).
 *
 * Capped to a small N (default 10, max 30) so the reactive payload per
 * chainEvents insert stays ~6 KB instead of ~36 KB.
 */
export const getEventTickerFeed = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const requested = args.limit ?? 10;
    // Clamp into a sensible band — guards against a misconfigured client
    // re-introducing the original 60-event payload.
    const limit = Math.max(1, Math.min(30, requested));
    return await ctx.db.query("chainEvents").order("desc").take(limit);
  },
});

/**
 * Returns battle-resolution chainEvents from the last `tickWindow` ticks
 * (default 3). Used by WorldMap to drive the combat vignette playback after a
 * bandit attack resolves.
 *
 * Implementation: read the current tick from `tickClock`, then walk the
 * `by_tick` index on chainEvents from `currentTick - tickWindow` and filter
 * down to battle-cluster event names. The result set is bounded by both the
 * tick window AND a hard `BATTLE_EVENT_FETCH_HARD_CAP` so a pathological
 * burst of battle events in a single tick can't blow up the payload.
 *
 * Reactive payload is much smaller than `getRecentChainEvents` because:
 *   1. Most events (MissionAssigned, ResourcesGathered, WorkerArrived, ...)
 *      are filtered out — only ~11 battle-cluster event names pass.
 *   2. The tick window means non-battle ticks return [].
 */
export const BATTLE_EVENT_FETCH_HARD_CAP = 50;

export const getBattleEvents = query({
  args: {
    tickWindow: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const requested = args.tickWindow ?? 3;
    // Clamp 1..20 — keeps the index scan bounded.
    const tickWindow = Math.max(1, Math.min(20, requested));

    // Latest tick from tickClock (single-row table). If absent (cold start /
    // pre-migration), fall back to scanning the last `BATTLE_EVENT_FETCH_HARD_CAP`
    // chainEvents and filtering. That keeps the query useful on a fresh DB
    // before tickClock is populated.
    const clock = await ctx.db.query("tickClock").order("desc").first();
    if (!clock) {
      const recent = await ctx.db
        .query("chainEvents")
        .order("desc")
        .take(BATTLE_EVENT_FETCH_HARD_CAP);
      return recent.filter((ev) => BATTLE_EVENT_NAME_SET.has(ev.eventName));
    }

    const minTick = Math.max(0, clock.tick - tickWindow);
    // by_tick index. Take(HARD_CAP) AFTER ordering desc — gives us the most
    // recent battle-window events, then we filter to battle names client-side
    // within Convex. (Convex queries can't `or`-match on a string field, so
    // post-filter is the cleanest path; the tick window already bounds the
    // scan tightly.)
    const windowed = await ctx.db
      .query("chainEvents")
      .withIndex("by_tick", (q) => q.gte("tick", minTick))
      .order("desc")
      .take(BATTLE_EVENT_FETCH_HARD_CAP);

    return windowed.filter((ev) => BATTLE_EVENT_NAME_SET.has(ev.eventName));
  },
});
