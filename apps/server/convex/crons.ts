import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

if (
  process.env.CLANWORLD_USE_FAKE_HEARTBEAT === "true" &&
  process.env.CLANWORLD_USE_REAL_INDEXER === "true"
) {
  throw new Error(
    "CLANWORLD_USE_FAKE_HEARTBEAT and CLANWORLD_USE_REAL_INDEXER are mutually exclusive",
  );
}

if (process.env.CLANWORLD_USE_FAKE_HEARTBEAT === "true") {
  crons.interval("heartbeat-safety-net", { seconds: 5 }, internal.heartbeat.advanceTick, {});
}

if (process.env.CLANWORLD_USE_REAL_INDEXER === "true") {
  crons.interval("real-indexer-snapshot-refresh", { seconds: 5 }, internal.indexer.refreshSnapshot, {});
  crons.interval("real-indexer-log-poller", { seconds: 3 }, internal.indexer.pollLogs, {});
}

crons.interval("gold-quote-refresh", { minutes: 5 }, internal.goldQuote.refreshGoldQuote, {});
crons.interval("kickstart-leaderboard-refresh", { minutes: 5 }, internal.kickstart.refreshKickstartLeaderboard, {});
crons.interval("kickstart-watched-candles-refresh", { minutes: 1 }, internal.kickstart.refreshWatchedTokenCandles, {});

// Issue #337: hourly storage retention purge. Frequent smaller runs keep
// append-only tables bounded without spiky mutation load.
crons.hourly(
  "retention-purge-stale-data",
  { minuteUTC: 0 },
  internal.retention.purgeStaleData,
  {},
);

export default crons;
