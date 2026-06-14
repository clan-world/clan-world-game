import { query, internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { ClansmanState } from "@clan-world/shared/generated/enums";
import { resolveHeartbeatIntervalSecondsForSnap } from "./getSnapshot";

/**
 * Per-clansman roster for ClansmanTab. Reads the latest `clanView` row, maps
 * the raw chain `ClansmanFullView[]` into a UI-friendly row shape, and
 * synthesizes the fields the tab renders:
 *   - mission   : action verb ("Idle" when waiting, "DEAD" when fallen)
 *   - location  : human region label (start-region while traveling)
 *   - eta       : ticks until mission settles, or null when idle/dead
 *   - cooldown  : ticks of cooldown remaining after mission ends, 0 = ready
 *   - hunger    : 0..1 — derived from clan-level isStarving flag
 *                  (per-clansman hunger isn't on chain; we use clan starvation
 *                   ramp so the visual warning still surfaces correctly)
 *   - isDead    : true when the chain `ClansmanState` is DEAD (3). Takes
 *                  precedence over any active mission — the cockpit renders
 *                  "DEAD" instead of "Idle" so wiped clans don't read as alive.
 *
 * Returns `[]` when there is no `clanView` row yet (cold demo / no indexer).
 * The frontend treats `[]` as "fall back to STUB_CLANSMEN" so the cockpit
 * always demos cleanly even with Convex offline.
 */

type RawRecord = Record<string, unknown>;

function asRecord(value: unknown): RawRecord | null {
  return value && typeof value === "object" ? (value as RawRecord) : null;
}

function fieldAt(value: unknown, key: string): unknown {
  return asRecord(value)?.[key];
}

function numberLike(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string" && value.length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function boolLike(value: unknown): boolean {
  return value === true;
}

const REGION_LABEL_BY_CHAIN_ID: Record<number, string> = {
  1: "Forest",
  2: "Mountains",
  3: "Unicorn Town",
  4: "West Farms",
  5: "East Farms",
  6: "West Docks",
  7: "East Docks",
  8: "Deep Sea",
};

const ACTION_LABEL_BY_ID: Record<number, string> = {
  0: "Idle",
  1: "Chop Wood",
  2: "Mine Iron",
  3: "Fish Docks",
  4: "Fish Deep Sea",
  5: "Harvest Wheat",
  6: "Deposit",
  7: "Upgrade Wall",
  8: "Upgrade Base",
  9: "Upgrade Monument",
  10: "Defend Base",
  11: "Market Buy",
  12: "Market Sell",
  13: "Wait",
  14: "Withdraw",
};

function actionLabel(action: number): string {
  return ACTION_LABEL_BY_ID[action] ?? "Working";
}

function regionLabel(regionId: number): string {
  return REGION_LABEL_BY_CHAIN_ID[regionId] ?? "Region";
}

/**
 * Derive a 0..1 hunger fraction for a clansman from clan-level starvation
 * state. We don't have per-clansman hunger on chain, so:
 *   - clan not starving → mild baseline (0.4) so the bar still renders
 *   - clan starving → ramp toward 1.0 based on ticks since starvationStartsAtTick
 *   - per-clansman jitter (id-seeded) so the four bars don't move in lockstep
 */
function deriveHunger(
  clansmanId: number,
  isStarving: boolean,
  starvationStartsAtTick: number,
  currentTick: number,
): number {
  // Stable per-clansman jitter ±0.08 around the base.
  const jitter = ((clansmanId * 2654435761) >>> 0) / 0xffffffff; // 0..1
  const jitterDelta = (jitter - 0.5) * 0.16;

  if (!isStarving) {
    return Math.max(0, Math.min(1, 0.4 + jitterDelta));
  }
  // Starving: ramp from 0.7 → 1.0 over the first 6 ticks of starvation.
  const ticksStarving = Math.max(0, currentTick - starvationStartsAtTick);
  const ramp = Math.min(1, 0.7 + ticksStarving * 0.05);
  return Math.max(0, Math.min(1, ramp + jitterDelta));
}

export interface ClansmanRow {
  id: string;
  mission: string;
  location: string;
  eta: number | null;
  /**
   * Absolute wall-clock time (unix seconds) when the active mission settles, or
   * null when idle/dead. Derived from the tick epoch (tickEpochStartedAt +
   * settlesAtTick * tickDurationSeconds) so the UI can show a human-readable
   * clock time ("ETA 3:42:10 AM") instead of a raw tick/timestamp number. The
   * client formats this with the viewer's local timezone.
   */
  etaTs: number | null;
  cooldown: number;
  hunger: number;
  /**
   * True when the chain reports this clansman as ClansmanState.DEAD (enum=3).
   * The tab uses this to override the mission/eta/cooldown display so a wiped
   * clan reads as DEAD instead of "Idle / ready".
   */
  isDead: boolean;
}

/**
 * Project a mission's settle *tick* onto wall-clock time (unix seconds) using
 * the tick epoch, so the UI can render a real clock time ("ETA 3:42:10 AM")
 * instead of a raw tick/timestamp number.
 *
 * etaTs = tickEpochStartedAt + settlesAtTick * tickDurationSeconds
 *
 * Returns null when there's no live ETA (`eta === null`, i.e. idle/dead) OR
 * when the tick epoch hasn't been surfaced yet (`tickEpochStartedAt <= 0`) — in
 * the latter case the projection would be garbage/relative-to-zero, so we leave
 * it null and let the tab fall back to the relative-ticks label rather than
 * render a misleading 1970-epoch clock.
 *
 * Exported as a pure function so the derivation is unit-testable (and the test
 * fails if the epoch-guard or the projection formula is reverted).
 */
export function deriveEtaTs(
  eta: number | null,
  settlesAtTick: number,
  tickEpochStartedAt: number,
  tickDurationSeconds: number,
): number | null {
  if (eta === null || tickEpochStartedAt <= 0) return null;
  return tickEpochStartedAt + settlesAtTick * tickDurationSeconds;
}

export const getClanClansmen = query({
  args: { clanId: v.number() },
  handler: async (ctx, { clanId }): Promise<ClansmanRow[]> => {
    const view = await ctx.db
      .query("clanView")
      .withIndex("by_clanId", (q) => q.eq("clanId", clanId))
      .order("desc")
      .first();
    if (!view) return [];

    const snap = await ctx.db.query("worldSnapshot").order("desc").first();
    const currentTick = snap?.tick ?? Number(view.derivedAtTick) ?? 0;
    const tickDurationMs = resolveHeartbeatIntervalSecondsForSnap({
      heartbeatIntervalSeconds: snap?.heartbeatIntervalSeconds,
      tickEpochDurationMs: snap?.tickEpochDurationMs,
    }) * 1000;
    const tickDurationSeconds = Math.max(1, Math.floor(tickDurationMs / 1000));

    const rows = Array.isArray(view.clansmen) ? view.clansmen : [];
    const out: ClansmanRow[] = [];
    for (const row of rows) {
      // Chain shape: ClansmanFullView { clansman: DerivedClansmanState, activeMission: Mission }
      // DerivedClansmanState wraps Clansman in `.clansman` AND adds `effectiveRegion`.
      const derived = fieldAt(row, "clansman") ?? row;
      const clansman = fieldAt(derived, "clansman") ?? derived;
      const mission = fieldAt(row, "activeMission") ?? fieldAt(derived, "activeMission");

      const clansmanId = numberLike(fieldAt(clansman, "clansmanId"));
      if (clansmanId <= 0) continue;

      // Dead-state check: ClansmanState.DEAD = 3 on chain. When a clansman is
      // dead, we still render the row so the roster reflects the wipe — but
      // we surface "DEAD" instead of mission/idle and zero out eta/cooldown
      // so the row doesn't read as "ready in 0t" (alive-looking).
      const clansmanStateRaw = numberLike(fieldAt(clansman, "state"), -1);
      const isDead = clansmanStateRaw === ClansmanState.DEAD;

      const missionActive = !isDead && boolLike(fieldAt(mission, "active"));
      const action = missionActive ? numberLike(fieldAt(mission, "action")) : 0;

      const currentRegion = numberLike(
        fieldAt(derived, "effectiveRegion") ??
          fieldAt(clansman, "currentRegion") ??
          view.baseRegion,
        Number(view.baseRegion ?? 0),
      );
      const startRegion = missionActive
        ? numberLike(fieldAt(mission, "startRegion"), currentRegion)
        : currentRegion;
      const targetRegion = missionActive
        ? numberLike(fieldAt(mission, "targetRegion"), currentRegion)
        : currentRegion;

      // Display: while traveling, we show the start region (where they are
      // RIGHT NOW); once at action, the target. Idle = current.
      const displayRegion = missionActive
        ? targetRegion === startRegion
          ? targetRegion
          : startRegion
        : currentRegion;

      const settlesAtTick = missionActive
        ? numberLike(fieldAt(mission, "settlesAtTick"))
        : 0;
      const eta =
        missionActive && settlesAtTick > currentTick
          ? settlesAtTick - currentTick
          : missionActive
            ? 0
            : null;

      // Cooldown is on the base Clansman record; expressed as a wall-clock
      // timestamp (cooldownEndsAtTs). Convert to remaining-ticks via the
      // current tick epoch.
      const cooldownEndsAtTs = numberLike(fieldAt(clansman, "cooldownEndsAtTs"));
      const tickEpochStartedAt = numberLike(snap?.tickEpochStartedAt);
      const nowSeconds = tickEpochStartedAt + currentTick * tickDurationSeconds;

      // Absolute wall-clock settle time (unix seconds). See deriveEtaTs: we
      // project the settle *tick* onto the tick epoch so the UI can render a
      // real clock time rather than a raw number. Null when idle/dead or when
      // the epoch hasn't surfaced yet (tab falls back to the relative-ticks
      // label in that case).
      const etaTs = deriveEtaTs(
        eta,
        settlesAtTick,
        tickEpochStartedAt,
        tickDurationSeconds,
      );
      const cooldown =
        cooldownEndsAtTs > nowSeconds
          ? Math.max(
              0,
              Math.ceil((cooldownEndsAtTs - nowSeconds) / tickDurationSeconds),
            )
          : 0;

      const hunger = deriveHunger(
        clansmanId,
        boolLike(view.isStarving),
        Number(view.starvationStartsAtTick ?? 0),
        currentTick,
      );

      out.push({
        id: `C${clansmanId}`,
        mission: isDead ? "DEAD" : missionActive ? actionLabel(action) : "Idle",
        location: regionLabel(displayRegion),
        // Dead clansmen never have an active mission OR a cooldown to wait on —
        // both fields are forced to a "no countdown" state so the row reads as
        // permanently fallen rather than "cooldown 3t / ready next tick".
        eta: isDead ? null : eta,
        etaTs: isDead ? null : etaTs,
        cooldown: isDead ? 0 : cooldown,
        hunger,
        isDead,
      });
    }
    return out;
  },
});

/**
 * Local-test seed: insert a synthetic `clanView` row with N clansmen so the
 * tab can be exercised without the full chain indexer running. Idempotent —
 * inserts a fresh row each call (clanView is append-only by design; the query
 * picks the newest by `_creationTime`).
 *
 * Match the schema field-by-field; consumers (mock.ts, tests) may pass an
 * override `clansmen` array. Hunger isn't seeded — it's derived in the query.
 */
export const seedClansmen = internalMutation({
  args: {
    clanId: v.number(),
    isStarving: v.optional(v.boolean()),
    starvationStartsAtTick: v.optional(v.number()),
    // TODO(post-demo): tighten validator (M-5 audit). Each clansman entry is
    // a deeply nested clanFullView projection with 10+ solidity-struct fields
    // (clansman.clansman.{clansmanId,clanId,state,currentRegion,...} +
    // activeMission.{active,action,startRegion,...}); enumerating them here
    // doubles file size and drifts as the contract evolves. Persists into
    // `clanView.clansmen` which is itself v.array(v.any()) by design.
    clansmen: v.optional(v.array(v.any())),
    currentTick: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const tick = args.currentTick ?? 0;
    const defaults = [
      // Idle, ready
      {
        clansman: {
          clansman: {
            clansmanId: 1,
            clanId: args.clanId,
            state: 0,
            currentRegion: 1,
            cooldownEndsAtTs: 0,
            lastMissionNonce: 0,
            carryWood: "0",
            carryIron: "0",
            carryWheat: "0",
            carryFish: "0",
          },
          effectiveRegion: 1,
        },
        activeMission: { active: false, action: 0 },
      },
      // Active raid → forest
      {
        clansman: {
          clansman: {
            clansmanId: 2,
            clanId: args.clanId,
            state: 1,
            currentRegion: 1,
            cooldownEndsAtTs: 0,
            lastMissionNonce: 1,
            carryWood: "0",
            carryIron: "0",
            carryWheat: "0",
            carryFish: "0",
          },
          effectiveRegion: 1,
        },
        activeMission: {
          active: true,
          action: 1, // ChopWood
          startRegion: 1,
          targetRegion: 1,
          settlesAtTick: tick + 2,
          startTick: tick,
          arrivalTick: tick,
          actionStartTick: tick,
        },
      },
    ];
    await ctx.db.insert("clanView", {
      clanId: args.clanId,
      owner: "0x0000000000000000000000000000000000000000",
      baseRegion: 1,
      clanState: 0,
      baseLevel: 1,
      wallLevel: 1,
      monumentLevel: 0,
      livingClansmen: (args.clansmen ?? defaults).length,
      isStarving: args.isStarving ?? false,
      starvationStartsAtTick: args.starvationStartsAtTick ?? 0,
      coldDamage: 0,
      goldBalance: "0",
      blueprintBalance: "0",
      vaultWood: "0",
      vaultIron: "0",
      vaultWheat: "0",
      vaultFish: "0",
      lootValue: "0",
      incomingDefenderIds: [],
      thisClanDefendingBaseId: 0,
      westPlot: null,
      eastPlot: null,
      clansmen: args.clansmen ?? defaults,
      derivedAtTick: tick,
      refreshedAt: Date.now(),
    });
  },
});
