import { query } from "./_generated/server";
import {
  HEARTBEAT_INTERVAL_SECONDS,
  WINTER_START_TICK,
  WINTER_DURATION_TICKS,
  WINTER_PERIOD_TICKS,
  SEASON_DURATION_TICKS,
} from "@clan-world/shared/generated/constants";
import { BanditState } from "@clan-world/shared/generated/enums";

const SEASON_LEN = Number(SEASON_DURATION_TICKS);
const WINTER_START = Number(WINTER_START_TICK);
const WINTER_DUR = Number(WINTER_DURATION_TICKS);
const WINTER_PERIOD = Number(WINTER_PERIOD_TICKS);

export interface DerivedSeasonState {
  currentSeasonNumber: number;
  seasonStartTick: number;
  seasonEndTick: number;
  winterActive: boolean;
  winterStartsAtTick: number;
  winterEndsAtTick: number;
}

/**
 * Derive season + winter state from `tick` using LibSeason-style math.
 *
 * IMPORTANT: this helper is ONLY for the empty-state fallback (no
 * `worldSnapshot` row yet) and as per-field fallback for legacy rows where
 * a specific optional season/winter field was not persisted (pre-Phase-4.4
 * indexer rows). For any row written by the current indexer the persisted
 * chain values are authoritative — see `_worldStateView` in
 * `packages/contracts/src/ClanWorld.sol`, which holds the OLD season fields
 * on storage until `finalizeSeason()` runs. Overriding persisted values
 * with this derivation flipped season N → N+1 one tick early (the freeze
 * window between `tick === seasonEndTick` and `finalizeSeason()`).
 *
 * Returns the same six season/winter fields the indexer persists, with
 * deterministic values for every `tick >= 0`.
 */
export function deriveSeasonState(tick: number): DerivedSeasonState {
  const seasonStartTick = Math.floor(tick / SEASON_LEN) * SEASON_LEN;
  const seasonEndTick = seasonStartTick + SEASON_LEN;
  // 1-based season number, matching contract `_world.currentSeasonNumber`
  // (initialised to 1 in ClanWorld constructor + ClanWorldStub).
  const currentSeasonNumber = Math.floor(tick / SEASON_LEN) + 1;

  // Winter cycles after WINTER_START. Mirrors LibSeason.isWinterActive():
  // active when `(tick - WINTER_START) % WINTER_PERIOD < WINTER_DURATION`,
  // and only after the first window has opened. `winterEndsAtTick` mirrors
  // contract `_winterWindowForTick`: it is always `startsAtTick +
  // WINTER_DURATION_TICKS`, regardless of active/inactive.
  let winterActive = false;
  let winterStartsAtTick: number;
  if (tick >= WINTER_START) {
    const elapsed = tick - WINTER_START;
    const cycleIndex = Math.floor(elapsed / WINTER_PERIOD);
    const cycleOffset = elapsed % WINTER_PERIOD;
    const cycleStart = WINTER_START + cycleIndex * WINTER_PERIOD;
    winterActive = cycleOffset < WINTER_DUR;
    winterStartsAtTick = winterActive ? cycleStart : cycleStart + WINTER_PERIOD;
  } else {
    winterStartsAtTick = WINTER_START;
  }
  const winterEndsAtTick = winterStartsAtTick + WINTER_DUR;

  return {
    currentSeasonNumber,
    seasonStartTick,
    seasonEndTick,
    winterActive,
    winterStartsAtTick,
    winterEndsAtTick,
  };
}

/**
 * Persisted-fields subset of `worldSnapshot` that this resolver reads.
 * Mirrors the optional season/winter fields written by `indexer.ts`. Keep
 * this in lockstep with `apps/server/convex/schema.ts:worldSnapshot`.
 */
export interface PersistedSnapshotSeasonFields {
  tick: number;
  heartbeatIntervalSeconds?: number;
  currentSeasonNumber?: number;
  seasonStartTick?: number;
  seasonEndTick?: number;
  seasonFinalized?: boolean;
  winterActive?: boolean;
  winterStartsAtTick?: number;
  winterEndsAtTick?: number;
}

/**
 * Resolve the six season/winter fields for a `worldSnapshot` row, with
 * persisted chain values winning over a per-field fallback to
 * `deriveSeasonState(snap.tick)` only when the field is `undefined` (legacy
 * pre-Phase-4.4 rows). This is the regression seam for issue #435.
 *
 * Exported so unit tests can exercise the freeze-window behaviour without
 * touching Convex's `query()` wrapper.
 */
export function resolveSeasonStateForSnap(
  snap: PersistedSnapshotSeasonFields,
): DerivedSeasonState {
  const derived = deriveSeasonState(snap.tick);
  return {
    currentSeasonNumber: snap.currentSeasonNumber !== undefined
      ? snap.currentSeasonNumber
      : derived.currentSeasonNumber,
    seasonStartTick: snap.seasonStartTick !== undefined
      ? snap.seasonStartTick
      : derived.seasonStartTick,
    seasonEndTick: snap.seasonEndTick !== undefined
      ? snap.seasonEndTick
      : derived.seasonEndTick,
    winterActive: snap.winterActive !== undefined
      ? snap.winterActive
      : derived.winterActive,
    winterStartsAtTick: snap.winterStartsAtTick !== undefined
      ? snap.winterStartsAtTick
      : derived.winterStartsAtTick,
    winterEndsAtTick: snap.winterEndsAtTick !== undefined
      ? snap.winterEndsAtTick
      : derived.winterEndsAtTick,
  };
}

export function normalizePausedAtTs(pausedAtTs: unknown): number | null {
  return typeof pausedAtTs === "number" && Number.isFinite(pausedAtTs) && pausedAtTs > 0
    ? pausedAtTs
    : null;
}

export function resolvePauseStateForSnap(snap: {
  worldPaused?: unknown;
  pausedAtTs?: unknown;
}): { worldPaused: boolean; pausedAtTs: number | null } {
  return {
    worldPaused: snap.worldPaused === true,
    pausedAtTs: snap.worldPaused === true ? normalizePausedAtTs(snap.pausedAtTs) : null,
  };
}

export function resolveHeartbeatIntervalSecondsForSnap(snap: {
  heartbeatIntervalSeconds?: unknown;
  tickEpochDurationMs?: unknown;
}): number {
  if (
    typeof snap.heartbeatIntervalSeconds === "number" &&
    Number.isFinite(snap.heartbeatIntervalSeconds) &&
    snap.heartbeatIntervalSeconds > 0
  ) {
    return snap.heartbeatIntervalSeconds;
  }
  if (
    typeof snap.tickEpochDurationMs === "number" &&
    Number.isFinite(snap.tickEpochDurationMs) &&
    snap.tickEpochDurationMs > 0
  ) {
    return Math.max(1, Math.floor(snap.tickEpochDurationMs / 1000));
  }
  return Number(HEARTBEAT_INTERVAL_SECONDS);
}

export const getSnapshot = query({
  handler: async (ctx) => {
    const snap = await ctx.db.query("worldSnapshot").order("desc").first();
    const defaultHeartbeatIntervalSeconds = Number(HEARTBEAT_INTERVAL_SECONDS);
    if (!snap) {
      return {
        tick: 0,
        heartbeatIntervalSeconds: defaultHeartbeatIntervalSeconds,
        tickEpoch: { startedAt: 0, durationMs: defaultHeartbeatIntervalSeconds * 1000 },
        regions: [],
        clans: [],
        activeBanditId: undefined,
        bandit: null,
        worldPaused: false,
        pausedAtTs: null,
        ...deriveSeasonState(0),
      };
    }
    const activeBanditId = typeof snap.activeBanditId === "number" && snap.activeBanditId > 0
      ? snap.activeBanditId
      : undefined;
    const activeBandit = activeBanditId === undefined
      ? null
      : await ctx.db
        .query("banditView")
        .withIndex("by_bandit_id", (q) => q.eq("id", activeBanditId))
        .order("desc")
        .first();
    const bandit =
      activeBandit
      && activeBandit.exists
      && activeBandit.state !== BanditState.None
      && activeBandit.state !== BanditState.Defeated
        ? {
          id: activeBandit.id,
          region: activeBandit.region,
          state: activeBandit.state,
          tier: activeBandit.tier,
          attackPower: activeBandit.attackPower,
          stateEnteredTick: activeBandit.stateEnteredTick,
          nextActionTick: activeBandit.nextActionTick,
          projectedTargetClanId: activeBandit.projectedTargetClanId,
        }
        : null;
    return {
      tick: snap.tick,
      heartbeatIntervalSeconds: resolveHeartbeatIntervalSecondsForSnap(snap),
      tickEpoch: {
        startedAt: snap.tickEpochStartedAt,
        durationMs: snap.tickEpochDurationMs,
      },
      regions: snap.regions,
      clans: snap.clans,
      activeBanditId,
      bandit,
      ...resolvePauseStateForSnap(snap),
      ...resolveSeasonStateForSnap(snap),
    };
  },
});
