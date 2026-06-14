/**
 * Storage retention purges for Convex tables (Issue #337).
 *
 * Two patterns:
 *
 *  1. **Time-window** (`purgeTimeWindowTable`): keep last `RETENTION_HOURS`
 *     of rows; delete everything older. Used for append-only history
 *     (chainEvents, agentLogs, whispers, orchEvents, humanSteeringMessages,
 *     pricePoint, tickHistory, memoryEvents, goldTxReceipts).
 *
 *  2. **Preserve-latest-per-group** (`purgeGroupedPreserveLatest`): keep
 *     last `RETENTION_HOURS` of rows AND always preserve the newest row
 *     for each group key, even if it's older than the cutoff. This is the
 *     resume-from-pause guarantee — clanView/banditView/marketState/
 *     worldSnapshot rows
 *     are the only source of truth for "what's the current world state?"
 *     after a long pause, so we must never delete the last row for a clan
 *     / bandit / market / world snapshot.
 *
 * Cron registration lives in `crons.ts`. Public entry is
 * `purgeStaleData` (internalMutation) — run hourly.
 *
 * Filtering uses Convex's implicit `by_creation_time` index via
 * `q.field("_creationTime")`. No schema changes required.
 */

import { internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import type { DataModel } from "./_generated/dataModel";
import type { GenericMutationCtx } from "convex/server";
import { v } from "convex/values";
import {
  PURGE_BATCH_SIZE,
  RETENTION_HOURS,
  TIME_WINDOW_TABLES,
  type TimeWindowTable,
} from "./retention.config";

type MutationCtx = GenericMutationCtx<DataModel>;

type GroupedTable = "clanView" | "banditView" | "marketState" | "worldSnapshot";
type PurgeTable = TimeWindowTable | GroupedTable;

interface PurgeResult {
  table: PurgeTable;
  deleted: number;
  /** True if we hit `PURGE_BATCH_SIZE` of stale rows and deleted at least one
   *  — i.e. there are likely MORE stale rows that didn't fit in this
   *  mutation's quota. The next hourly run mops them up. */
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

  // Sequential delete loop — Convex enforces a per-function concurrent I/O
  // cap (~1000); Promise.all over PURGE_BATCH_SIZE=5000 deletes would blow
  // through that and fail the mutation. `deleted` is incremented post-await
  // so it accurately reflects rows actually purged even on partial failure.
  let deleted = 0;
  for (const row of stale) {
    await ctx.db.delete(row._id);
    deleted += 1;
  }

  return {
    table,
    deleted,
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
  // restricts `T` to the preserve-latest tables.
  const stale = await (ctx.db.query(table) as any)
    .withIndex("by_creation_time", (q: any) => q.lt("_creationTime", cutoff))
    .take(PURGE_BATCH_SIZE);

  // Cache "latest row per group" lookups so we don't re-query for every
  // stale row from the same group. We cache the PROMISE (not the resolved
  // value) so that even if callers ever process stale rows concurrently
  // (today they don't — the loop below is sequential — but defense in
  // depth), the second caller awaits the in-flight query rather than
  // launching a duplicate.
  const latestByGroup = new Map<string, Promise<{ _id: string; _creationTime: number } | null>>();

  function latestFor(groupKey: number | null) {
    const cacheKey = groupKey === null ? "__singleton__" : String(groupKey);
    const cached = latestByGroup.get(cacheKey);
    if (cached) return cached;

    const lookup: Promise<{ _id: string; _creationTime: number } | null> =
      indexName && indexField && groupKey !== null
        ? ((ctx.db.query(table) as any)
            .withIndex(indexName, (q: any) => q.eq(indexField, groupKey))
            .order("desc")
            .first() as Promise<{ _id: string; _creationTime: number } | null>)
        : // Singleton-style: find the newest row in the whole table.
          ((ctx.db.query(table) as any)
            .withIndex("by_creation_time")
            .order("desc")
            .first() as Promise<{ _id: string; _creationTime: number } | null>);

    latestByGroup.set(cacheKey, lookup);
    return lookup;
  }

  let deleted = 0;
  for (const row of stale) {
    const groupKey = groupKeyOf(row);
    const latest = await latestFor(groupKey);
    // Preserve if this row IS the latest for its group, or no newer row
    // exists for the group. Otherwise it's safe to delete.
    if (!latest || latest._id === row._id) continue;
    if (latest._creationTime <= row._creationTime) continue;
    await ctx.db.delete(row._id);
    deleted += 1;
  }

  return {
    table,
    deleted,
    truncated: deleted > 0 && stale.length === PURGE_BATCH_SIZE,
  };
}

/**
 * Per-grouped-table arg packs. Centralized so the orchestrator and the
 * `purgeOneGroupedTable` worker agree on the index/groupKey shape for each
 * preserve-latest table.
 */
type GroupedTableConfig = {
  table: GroupedTable;
  indexName: string | null;
  indexField: string | null;
  groupKeyOf: (row: any) => number | null;
};

const GROUPED_TABLE_CONFIGS: readonly GroupedTableConfig[] = [
  {
    table: "clanView",
    indexName: "by_clanId",
    indexField: "clanId",
    groupKeyOf: (row) => (typeof row.clanId === "number" ? row.clanId : null),
  },
  {
    table: "banditView",
    indexName: "by_bandit_id",
    indexField: "id",
    groupKeyOf: (row) => (typeof row.id === "number" ? row.id : null),
  },
  {
    table: "marketState",
    indexName: null,
    indexField: null,
    groupKeyOf: () => null,
  },
  {
    table: "worldSnapshot",
    indexName: null,
    indexField: null,
    groupKeyOf: () => null,
  },
] as const;

function logPurgeResult(r: PurgeResult): void {
  console.log(
    `[retention] purged ${r.deleted} rows from ${r.table}` +
      (r.truncated ? " (truncated=true; more pending)" : ""),
  );
  if (r.truncated) {
    console.warn(
      `[retention] table ${r.table} purge truncated at batch size ` +
        `${PURGE_BATCH_SIZE}; backlog will be drained on next hourly run`,
    );
  }
}

/**
 * Per-table worker: purge ONE time-window table. Exposed as an internal
 * mutation so the orchestrator can schedule one of these per table — each
 * scheduled call runs in its own mutation transaction with its own op
 * budget, preventing cumulative-cap failures across tables.
 */
export const purgeOneTimeWindowTable = internalMutation({
  args: {
    table: v.string(),
    cutoff: v.number(),
  },
  handler: async (ctx, { table, cutoff }) => {
    if (!(TIME_WINDOW_TABLES as readonly string[]).includes(table)) {
      throw new Error(
        `[retention] purgeOneTimeWindowTable: unknown table "${table}"`,
      );
    }
    const result = await purgeTimeWindowTable(
      ctx,
      table as TimeWindowTable,
      cutoff,
    );
    logPurgeResult(result);
    return result;
  },
});

/**
 * Per-table worker: purge ONE preserve-latest grouped table. Same isolation
 * rationale as `purgeOneTimeWindowTable`.
 */
export const purgeOneGroupedTable = internalMutation({
  args: {
    table: v.union(
      v.literal("clanView"),
      v.literal("banditView"),
      v.literal("marketState"),
      v.literal("worldSnapshot"),
    ),
    cutoff: v.number(),
  },
  handler: async (ctx, { table, cutoff }) => {
    const config = GROUPED_TABLE_CONFIGS.find((c) => c.table === table);
    if (!config) {
      throw new Error(
        `[retention] purgeOneGroupedTable: unknown table "${table}"`,
      );
    }
    const result = await purgeGroupedPreserveLatest(ctx, {
      table: config.table,
      cutoff,
      indexName: config.indexName,
      indexField: config.indexField,
      groupKeyOf: config.groupKeyOf,
    });
    logPurgeResult(result);
    return result;
  },
});

/**
 * Hourly purge orchestrator. Schedules one independent mutation per
 * retention-managed table so each table's purge gets its own per-mutation
 * op budget (Convex caps a single mutation at ~16k document ops). With 10+
 * tables × PURGE_BATCH_SIZE=5000, running them all inline could exceed the
 * cap and silently skip retention work; the scheduler split prevents that.
 *
 * Per-table observability lives inside each per-table worker (see
 * `purgeOneTimeWindowTable` / `purgeOneGroupedTable`). The orchestrator
 * emits a single line stating how many tables were scheduled.
 */
export const purgeStaleData = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const cutoff = now - RETENTION_HOURS * 60 * 60 * 1000;
    let scheduled = 0;

    for (const table of TIME_WINDOW_TABLES) {
      await ctx.scheduler.runAfter(
        0,
        internal.retention.purgeOneTimeWindowTable,
        { table, cutoff },
      );
      scheduled += 1;
    }

    for (const config of GROUPED_TABLE_CONFIGS) {
      await ctx.scheduler.runAfter(
        0,
        internal.retention.purgeOneGroupedTable,
        { table: config.table, cutoff },
      );
      scheduled += 1;
    }

    console.log(
      `[retention] orchestrator scheduled ${scheduled} per-table purges ` +
        `(cutoff=${new Date(cutoff).toISOString()})`,
    );

    return { scheduled, cutoff };
  },
});
