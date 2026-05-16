/**
 * Retention policy constants for Convex tables.
 *
 * Issue #337: bound storage growth without breaking resume-from-pause.
 *
 * The game never replays history more than ~24-36h back, so anything older
 * than `RETENTION_HOURS` is safe to purge — EXCEPT for tables where we need
 * the latest row preserved for resume-from-pause semantics (clanView,
 * banditView, marketState; see `retention.ts`).
 *
 * Single source of truth — tune here, not in individual purge calls.
 */

/** Default retention window for time-bucketed tables (hours). */
export const RETENTION_HOURS = 36;

/** Convex mutation row-write soft cap. Process at most this many rows per
 *  purge invocation per table to stay within per-mutation limits (Convex
 *  caps a single mutation at ~16k document operations). The daily cron at
 *  04:00 UTC keeps daily deltas well below this; if a table exceeds the
 *  cap in one run, `purgeStaleData` returns `truncated=true` for that
 *  table and the next nightly run drains the rest.
 *
 *  Budget per run (worst case): 6 time-window tables × 1000 + 3 grouped
 *  tables × ~1100 ≈ 9000 ops, well under the per-mutation cap. */
export const PURGE_BATCH_SIZE = 1000;

/** Tables with simple time-window retention (delete everything older than
 *  `cutoff`). All ordered by `_creationTime` (Convex implicit index). */
export const TIME_WINDOW_TABLES = [
  "chainEvents",
  "agentLogs",
  "whispers",
  "orchEvents",
  "humanSteeringMessages",
  "pricePoint",
] as const;

export type TimeWindowTable = (typeof TIME_WINDOW_TABLES)[number];
