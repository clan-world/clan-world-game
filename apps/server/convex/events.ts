import { v } from "convex/values";
import { query } from "./_generated/server";

// Battle / resolution event names that drive `getBattleEvents`. Used to filter
// the chainEvents stream down to just combat-relevant events the WorldMap
// consumes for its combat vignette playback.
//
// Trimmed to events whose Solidity signatures carry a tick arg (see
// `packages/contracts/src/IClanWorld.sol`). The indexer at
// `apps/server/convex/indexer.ts` writes
//   tick = event.args.tick ?? event.args.atTick ?? event.args.openedTick
// for each chainEvents row. Events without any of those three args land with
// `tick: undefined` and are SILENTLY excluded from any `by_tick` /
// `by_event_tick` index scan — so listing them here would just produce dead
// letters and trap a future reader into thinking they're surfaced.
//
// Other "battle-shaped" events lack tick args at the contract level:
//   - WallDamagedByBandit (uint32 clanId, uint8 newLevel, uint32 banditId)
//   - ClansmanKilledByBandit (uint32 clanId, uint32 clansmanId, uint32 banditId)
//   - BlueprintAwarded (uint32 clanId, uint32 banditId, uint256 amount)
//   - LootDistributed (uint32 banditId, uint32[] clanIdsRewarded, ...amounts)
//   - LootDistributedToDefender (uint32 banditId, uint32 clanId, uint32 clansmanId, ...amounts)
// To surface them in a future feed, either add a tick arg to the contract
// event OR have the indexer fall back to `tickClock.tick` when no tick arg is
// present.
//
// Today WorldMap only acts on `BanditAttackResolved`, but the wider cluster
// (defeated / target died / escaped / state changed / blueprint earned) is
// included so future battle-feed consumers don't need a schema change.
export const BATTLE_EVENT_NAMES = [
  "BanditAttackResolved", // atTick
  "BanditDefeated", // atTick
  "BanditTargetDied", // tick
  "BanditEscaped", // atTick
  "BanditStateChanged", // atTick
  "BlueprintEarned", // tick
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
 * (default 3, inclusive of current tick). Used by WorldMap to drive the
 * combat vignette playback after a bandit attack resolves.
 *
 * Implementation: read the current tick from `tickClock`, then for each
 * battle-event name run a parallel `by_event_tick`-indexed scan over the
 * tick window and merge the results. This avoids the "take(50) before
 * filter" hazard — a burst of non-battle events in a recent tick window can
 * no longer evict a battle event from the result set (issue #336 super-swarm
 * round 2).
 *
 * Reactive payload is much smaller than `getRecentChainEvents` because:
 *   1. Per-name index scans skip non-battle events at the DB level — they
 *      never enter the in-memory window.
 *   2. The tick window means non-battle ticks return [].
 */
// Per-name take. Default tickWindow=3, 6 battle names → at most 6 * 20 = 120
// rows scanned before the final slice. Tunable; 20 leaves headroom over the
// observed per-tick battle-event frequency (~1-2/tick worst case).
export const BATTLE_EVENT_PER_NAME_TAKE = 20;
// Final cap on the merged + sorted result returned to clients. Sized so a
// pathological multi-event tick (e.g. defended-attack writes ~4 events) over
// a 20-tick window still fits comfortably while bounding payload growth.
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
    // pre-migration), fall back to a small per-name desc scan with no tick
    // floor. That keeps the query useful on a fresh DB before tickClock is
    // populated.
    const clock = await ctx.db.query("tickClock").order("desc").first();

    if (!clock) {
      const perName = await Promise.all(
        BATTLE_EVENT_NAMES.map((name) =>
          ctx.db
            .query("chainEvents")
            .withIndex("by_event_tick", (q) => q.eq("eventName", name))
            .order("desc")
            .take(BATTLE_EVENT_PER_NAME_TAKE),
        ),
      );
      return perName
        .flat()
        .sort((a, b) => (b.tick ?? 0) - (a.tick ?? 0))
        .slice(0, BATTLE_EVENT_FETCH_HARD_CAP);
    }

    // tickWindow=3 at currentTick=10 → minTick = 8 → ticks 8, 9, 10 (3 ticks).
    // The `+ 1` corrects the off-by-one in the original implementation, which
    // scanned (tickWindow + 1) ticks (issue #336 super-swarm SHOULD-fix-1).
    const minTick = Math.max(0, clock.tick - tickWindow + 1);

    const perName = await Promise.all(
      BATTLE_EVENT_NAMES.map((name) =>
        ctx.db
          .query("chainEvents")
          .withIndex("by_event_tick", (q) =>
            q.eq("eventName", name).gte("tick", minTick),
          )
          .order("desc")
          .take(BATTLE_EVENT_PER_NAME_TAKE),
      ),
    );

    // Belt-and-suspenders: re-filter through the name set in case a future
    // refactor expands the per-name scan to a broader query.
    return perName
      .flat()
      .filter((ev) => BATTLE_EVENT_NAME_SET.has(ev.eventName))
      .sort((a, b) => (b.tick ?? 0) - (a.tick ?? 0))
      .slice(0, BATTLE_EVENT_FETCH_HARD_CAP);
  },
});
