/**
 * Retention policy constants for Convex tables.
 *
 * Issue #337: bound storage growth without breaking resume-from-pause.
 *
 * The game never replays history more than ~24-36h back, so anything older
 * than `RETENTION_HOURS` is safe to purge — EXCEPT for tables where we need
 * the latest row preserved for resume-from-pause semantics (clanView,
 * banditView, marketState, worldSnapshot; see `retention.ts`).
 *
 * Single source of truth — tune here, not in individual purge calls.
 */

/** Default retention window for time-bucketed tables (hours). */
export const RETENTION_HOURS = 36;

/** Convex mutation row-write soft cap. Process at most this many rows per
 *  purge invocation per table to stay within per-mutation limits (Convex
 *  caps a single mutation at ~16k document operations split across reads
 *  and writes; concurrent I/O is also capped around ~1000). The hourly
 *  cron keeps deltas smooth; if a table exceeds the cap in one run,
 *  `purgeStaleData` returns `truncated=true` for that table and the next
 *  hourly run drains the rest.
 *
 *  Per-table op budget (worst case):
 *    - Time-window table: 1 read (TAKE up to this cap) + this-cap deletes
 *      = up to (PURGE_BATCH_SIZE + 1) ops.
 *    - Grouped (preserve-latest) table: 1 stale-row TAKE +
 *      up-to-distinct-groups reads (one per cached groupKey via
 *      `latestFor`) + up-to-stale-row deletes. Worst case is the same
 *      shape as time-window when every stale row belongs to a different
 *      group, so ~(2 * PURGE_BATCH_SIZE + 1) ops.
 *
 *  Per-RUN op budget: the orchestrator `purgeStaleData` does NOT process
 *  all tables in a single mutation — it schedules a separate internal
 *  mutation per table via `ctx.scheduler.runAfter(0, ...)`. Each scheduled
 *  mutation is independent and gets its own per-mutation op budget. That
 *  keeps the worst case bounded by the per-table budget above regardless
 *  of how many retention-managed tables exist. */
export const PURGE_BATCH_SIZE = 5000;

/** Tables with simple time-window retention (delete everything older than
 *  `cutoff`). All ordered by `_creationTime` (Convex implicit index). */
export const TIME_WINDOW_TABLES = [
  "chainEvents",
  "agentLogs",
  "whispers",
  "orchEvents",
  "humanSteeringMessages",
  "pricePoint",
  "tickHistory",
  "memoryEvents",
  "goldTxReceipts",
  "inftTransfers",
] as const;

export type TimeWindowTable = (typeof TIME_WINDOW_TABLES)[number];
