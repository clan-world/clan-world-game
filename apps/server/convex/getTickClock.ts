import { query } from "./_generated/server";
import { HEARTBEAT_INTERVAL_SECONDS, SEASON_DURATION_TICKS } from "@clan-world/shared/generated/constants";

export const getTickClock = query({
  handler: async (ctx) => {
    const clock = await ctx.db.query("tickClock").order("desc").first();
    if (!clock) {
      return {
        tick: 0,
        blockNumber: undefined,
        tickEpochStartedAt: 0,
        tickEpochDurationMs: Number(HEARTBEAT_INTERVAL_SECONDS) * 1000,
        seasonStartTick: 0,
        seasonEndTick: Number(SEASON_DURATION_TICKS),
        winterActive: false,
        winterStartsAtTick: undefined,
      };
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
