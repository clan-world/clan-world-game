import { query } from "./_generated/server";

export const getTickClock = query({
  handler: async (ctx) => {
    // tickClock is a single-row table — patched in place by the indexer on
    // every tick. `.first()` is sufficient; no need to `.order("desc")`.
    const clock = await ctx.db.query("tickClock").first();
    if (!clock) {
      // Return null so callers can fall back to worldSnapshot.tick when the
      // tickClock row has not yet been written (pre-first-heartbeat cold start).
      return null;
    }
    return {
      tick: clock.tick,
      blockNumber: clock.blockNumber,
      tickEpochStartedAt: clock.tickEpochStartedAt,
      tickEpochDurationMs: clock.tickEpochDurationMs,
      currentSeasonNumber: clock.currentSeasonNumber,
      seasonStartTick: clock.seasonStartTick,
      seasonEndTick: clock.seasonEndTick,
      winterActive: clock.winterActive,
      winterStartsAtTick: clock.winterStartsAtTick,
    };
  },
});
