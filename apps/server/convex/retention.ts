/**
 * Storage retention purges for Convex tables (Issue #337).
 *
 * Two patterns:
 *
 *  1. **Time-window** (`purgeTimeWindowTable`): keep last `RETENTION_HOURS`
 *     of rows; delete everything older. Used for append-only history
 *     (chainEvents, agentLogs, whispers, orchEvents, humanSteeringMessages,
 *     pricePoint).
 *
 *  2. **Preserve-latest-per-group** (`purgeGroupedPreserveLatest`): keep
 *     last `RETENTION_HOURS` of rows AND always preserve the newest row
 *     for each group key, even if it's older than the cutoff. This is the
 *     resume-from-pause guarantee — clanView/banditView/marketState rows
 *     are the only source of truth for "what's the current world state?"
 *     after a long pause, so we must never delete the last row for a clan
 *     / bandit / market.
 *
 * Cron registration lives in `crons.ts`. Public entry is
 * `purgeStaleData` (internalMutation) — run daily at 04:00 UTC.
 *
 * Filtering uses Convex's implicit `by_creation_time` index via
 * `q.field("_creationTime")`. No schema changes required.
 */

import { internalMutation } from "./_generated/server";
import type { DataModel } from "./_generated/dataModel";
import type { GenericMutationCtx } from "convex/server";
import {
  PURGE_BATCH_SIZE,
  RETENTION_HOURS,
  TIME_WINDOW_TABLES,
  type TimeWindowTable,
} from "./retention.config";

type MutationCtx = GenericMutationCtx<DataModel>;

type GroupedTable = "clanView" | "banditView" | "marketState";
type PurgeTable = TimeWindowTable | GroupedTable;

interface PurgeResult {
  table: PurgeTable;
  deleted: number;
  /** True if we hit `PURGE_BATCH_SIZE` of stale rows AND deleted them all
   *  — i.e. there are likely MORE stale rows that didn't fit in this
   *  mutation's quota. The next nightly run mops them up. */
  truncated: boolean;
}

/**
 * Delete all rows with `_creationTime < cutoff`, in a single batch capped
 * at `PURGE_BATCH_SIZE`. Returns the count deleted and whether the cap
 * was reached.
 *
 * Why not scan post-purge to count remaining rows? Convex mutations are
 * capped at ~16k document operations per call. Scanning every retention
 * table to count rows would blow that budget. The `truncated` flag is the
 * sufficient health signal — it goes true whenever we couldn't drain the
 * stale set in one run, which is the actual "retention isn't keeping up"
 * condition.
 */
export async function purgeTimeWindowTable(
  ctx: MutationCtx,
  table: TimeWindowTable,
  cutoff: number,
): Promise<PurgeResult> {
  const stale = await ctx.db
    .query(table)
    .withIndex("by_creation_time", (q) => q.lt("_creationTime", cutoff))
    .take(PURGE_BATCH_SIZE);

  await Promise.all(stale.map((row) => ctx.db.delete(row._id)));

  return {
    table,
    deleted: stale.length,
    truncated: stale.length === PURGE_BATCH_SIZE,
  };
}

/**
 * Preserve-latest-per-group purge for append-only views.
 *
 * Algorithm:
 *   1. Collect old rows (`_creationTime < cutoff`) up to `PURGE_BATCH_SIZE`.
 *   2. For each old row, look up the newest row in its group via the
 *      group index.
 *   3. Delete the old row IFF a strictly newer row exists in the same
 *      group (i.e. the old row is not the latest for its group).
 *
 * `groupKeyOf` extracts the group-key value from a row; `indexName` /
 * `indexField` describe the Convex index used to find the latest per group.
 * For `marketState` (singleton, no group key) pass `groupKeyOf: () => null`
 * and `indexName: null`; we'll fall back to "is there ANY newer row?"
 */
export async function purgeGroupedPreserveLatest<T extends GroupedTable>(
  ctx: MutationCtx,
  args: {
    table: T;
    cutoff: number;
    indexName: string | null;
    indexField: string | null;
    groupKeyOf: (row: any) => number | null;
  },
): Promise<PurgeResult> {
  const { table, cutoff, indexName, indexField, groupKeyOf } = args;

  // Generic-`T` table forces TS to keep the per-schema index/field types as
  // a union — `q.lt("_creationTime", number)` then fails the union-narrowing
  // check (even though `_creationTime` is a `number` on every table). Cast
  // through `any` here; the runtime is fine, and the outer signature still
  // restricts `T` to the three preserve-latest tables.
  const stale = await (ctx.db.query(table) as any)
    .withIndex("by_creation_time", (q: any) => q.lt("_creationTime", cutoff))
    .take(PURGE_BATCH_SIZE);

  // Cache "latest row per group" lookups so we don't re-query for every
  // stale row from the same group.
  const latestByGroup = new Map<string, { _id: string; _creationTime: number } | null>();

  async function latestFor(groupKey: number | null) {
    const cacheKey = groupKey === null ? "__singleton__" : String(groupKey);
    if (latestByGroup.has(cacheKey)) return latestByGroup.get(cacheKey)!;

    let latest: { _id: string; _creationTime: number } | null;
    if (indexName && indexField && groupKey !== null) {
      latest = (await (ctx.db.query(table) as any)
        .withIndex(indexName, (q: any) => q.eq(indexField, groupKey))
        .order("desc")
        .first()) as { _id: string; _creationTime: number } | null;
    } else {
      // Singleton-style: find the newest row in the whole table.
      latest = (await (ctx.db.query(table) as any)
        .withIndex("by_creation_time")
        .order("desc")
        .first()) as { _id: string; _creationTime: number } | null;
    }
    latestByGroup.set(cacheKey, latest);
    return latest;
  }

  let deleted = 0;
  await Promise.all(
    stale.map(async (row: any) => {
      const groupKey = groupKeyOf(row);
      const latest = await latestFor(groupKey);
      // Preserve if this row IS the latest for its group, or no newer row
      // exists for the group. Otherwise it's safe to delete.
      if (!latest || latest._id === row._id) return;
      if (latest._creationTime <= row._creationTime) return;
      await ctx.db.delete(row._id);
      deleted += 1;
    }),
  );

  return {
    table,
    deleted,
    truncated: stale.length === PURGE_BATCH_SIZE,
  };
}

/**
 * Daily purge entry point. Walks every retention-managed table, emits
 * per-table summary logs, and warns when any per-table purge truncates
 * (signal that retention isn't keeping up — see #337 acceptance criteria).
 */
export const purgeStaleData = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const cutoff = now - RETENTION_HOURS * 60 * 60 * 1000;
    const results: PurgeResult[] = [];

    // Time-window tables: pure age-based purge.
    for (const table of TIME_WINDOW_TABLES) {
      const result = await purgeTimeWindowTable(ctx, table, cutoff);
      results.push(result);
    }

    // Preserve-latest tables: keep newest-per-group even if it's old.
    results.push(
      await purgeGroupedPreserveLatest(ctx, {
        table: "clanView",
        cutoff,
        indexName: "by_clanId",
        indexField: "clanId",
        groupKeyOf: (row) => (typeof row.clanId === "number" ? row.clanId : null),
      }),
    );
    results.push(
      await purgeGroupedPreserveLatest(ctx, {
        table: "banditView",
        cutoff,
        indexName: "by_bandit_id",
        indexField: "id",
        groupKeyOf: (row) => (typeof row.id === "number" ? row.id : null),
      }),
    );
    results.push(
      await purgeGroupedPreserveLatest(ctx, {
        table: "marketState",
        cutoff,
        indexName: null,
        indexField: null,
        groupKeyOf: () => null,
      }),
    );

    // Observability: one log line per table + a summary. `truncated=true`
    // is the "retention not keeping up" signal — it means the daily purge
    // couldn't drain the stale set in one mutation. Dashboard alerts can
    // grep for "truncated=true".
    for (const r of results) {
      console.log(
        `[retention] purged ${r.deleted} rows from ${r.table}` +
          (r.truncated ? " (truncated=true; more pending)" : ""),
      );
      if (r.truncated) {
        console.warn(
          `[retention] table ${r.table} purge truncated at batch size ` +
            `${PURGE_BATCH_SIZE}; backlog will be drained on next nightly run`,
        );
      }
    }

    const totalDeleted = results.reduce((sum, r) => sum + r.deleted, 0);
    console.log(
      `[retention] purge run complete: deleted=${totalDeleted}` +
        ` across ${results.length} tables (cutoff=${new Date(cutoff).toISOString()})`,
    );

    return { results, totalDeleted, cutoff };
  },
});
