import { query } from "./_generated/server";
import { HEARTBEAT_INTERVAL_SECONDS, SEASON_DURATION_TICKS } from "@clan-world/shared/generated/constants";

export const getTickClock = query({
  handler: async (ctx) => {
    const clock = await ctx.db.query("tickClock").order("desc").first();
    if (!clock) {
      // Return null so callers can fall back to worldSnapshot.tick during
      // migration window when tickClock table doesn't exist yet.
      return null;
    }
    return {
      tick: clock.tick,
      blockNumber: clock.blockNumber,
      tickEpochStartedAt: clock.tickEpochStartedAt,
      tickEpochDurationMs: clock.tickEpochDurationMs,
      seasonStartTick: clock.seasonStartTick,
      seasonEndTick: clock.seasonEndTick,
      winterActive: clock.winterActive,
      winterStartsAtTick: clock.winterStartsAtTick,
    };
  },
});
