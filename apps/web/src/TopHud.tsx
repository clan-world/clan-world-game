import { useEffect, useMemo, useRef, useState } from 'react';
import { useSafeQuery as useQuery } from './hooks/useSafeQuery';
import { api } from '../../server/convex/_generated/api';
import type { Doc } from '../../server/convex/_generated/dataModel';
import { SEASON_DURATION_TICKS } from '@clan-world/shared/generated/constants';
import { DEMO_MODE } from './config/env';

const TICKS_PER_SEASON = Number(SEASON_DURATION_TICKS);

// Demo bandit state mirrors WorldMap.tsx DEMO_BANDIT so both components agree.
const DEMO_BANDIT_ATTACKS_AT_TICK = 48;

// Clan heraldic color for bandit chip
const BANDIT_RED = '#b23a48';
const GOLD = '#d4a24c';
const PARCHMENT = '#e8d8b5';
const INK = '#3d2817';
const FALLBACK_TICK_DURATION_MS = 59_000;

type TickCountdownAnchor = {
  tick: number;
  startedAtMs: number;
  durationMs: number;
};

type SnapshotBandit = Pick<Doc<'banditView'>, 'state' | 'nextActionTick'>;

function useBanditWarning(liveTick: number, bandit: SnapshotBandit | null): { active: boolean; ticksUntil: number } {
  const attackTick = DEMO_MODE ? DEMO_BANDIT_ATTACKS_AT_TICK : bandit?.nextActionTick;
  if (typeof attackTick !== 'number') return { active: false, ticksUntil: 999 };
  const ticksUntil = attackTick - liveTick;
  return { active: ticksUntil <= 8 && ticksUntil >= 0, ticksUntil };
}

export function TopHud({ liveTick }: { liveTick: number }) {
  const clock = useQuery(api.getTickClock.getTickClock);
  const liveSnapshot = useQuery(api.getSnapshot.getSnapshot);
  const tickCountdownAnchorRef = useRef<TickCountdownAnchor>({
    tick: liveTick,
    startedAtMs: Date.now(),
    durationMs: FALLBACK_TICK_DURATION_MS,
  });
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    if (tickCountdownAnchorRef.current.tick !== liveTick) {
      const epoch = clock
        ? { startedAt: clock.tickEpochStartedAt, durationMs: clock.tickEpochDurationMs }
        : undefined;
      const canUseClockEpoch =
        clock?.tick === liveTick &&
        epoch &&
        typeof epoch.startedAt === 'number' &&
        typeof epoch.durationMs === 'number' &&
        epoch.durationMs > 0;
      tickCountdownAnchorRef.current = {
        tick: liveTick,
        startedAtMs: canUseClockEpoch
          ? epoch.startedAt < 10_000_000_000
            ? epoch.startedAt * 1000
            : epoch.startedAt
          : Date.now(),
        durationMs: canUseClockEpoch ? epoch.durationMs : FALLBACK_TICK_DURATION_MS,
      };
    }
    setNowMs(Date.now());
  }, [liveTick, clock?.tick, clock?.tickEpochStartedAt, clock?.tickEpochDurationMs]);

  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 250);
    return () => window.clearInterval(id);
  }, []);

  const { currentSeasonNumber, seasonStartTick, seasonEndTick, winterActive, winterStartsAtTick } = useMemo(() => {
    // Season fields sourced from tickClock (issue #333) — was getSnapshot pre-split.
    return {
      currentSeasonNumber: typeof clock?.currentSeasonNumber === 'number' ? clock.currentSeasonNumber : null,
      seasonStartTick: typeof clock?.seasonStartTick === 'number' ? clock.seasonStartTick : null,
      seasonEndTick: typeof clock?.seasonEndTick === 'number' ? clock.seasonEndTick : null,
      winterActive: clock?.winterActive === true,
      winterStartsAtTick: typeof clock?.winterStartsAtTick === 'number' ? clock.winterStartsAtTick : null,
    };
  }, [clock]);

  // Season progress bar: 0..1
  const seasonProgress = useMemo(() => {
    if (seasonStartTick !== null && seasonEndTick !== null && seasonEndTick > seasonStartTick) {
      return Math.max(0, Math.min(1, (liveTick - seasonStartTick) / (seasonEndTick - seasonStartTick)));
    }
    // Fallback: derive from tick % TICKS_PER_SEASON
    return (liveTick % TICKS_PER_SEASON) / TICKS_PER_SEASON;
  }, [liveTick, seasonStartTick, seasonEndTick]);

  const seasonNumber = useMemo(() => {
    if (currentSeasonNumber !== null) return currentSeasonNumber;
    return Math.floor(liveTick / TICKS_PER_SEASON) + 1;
  }, [currentSeasonNumber, liveTick]);

  // Winter approaching warning: within 20 ticks
  const winterWarning = useMemo(() => {
    if (winterActive) return false;
    if (winterStartsAtTick === null) return false;
    return winterStartsAtTick - liveTick <= 20 && winterStartsAtTick > liveTick;
  }, [winterActive, winterStartsAtTick, liveTick]);

  const { active: banditActive, ticksUntil: banditTicksUntil } = useBanditWarning(liveTick, liveSnapshot?.bandit ?? null);
  const tickCountdown = useMemo(() => {
    const { startedAtMs, durationMs } = tickCountdownAnchorRef.current;
    const elapsed = Math.max(0, nowMs - startedAtMs);
    const progress = Math.max(0, Math.min(1, elapsed / durationMs));
    return {
      remainingPct: Math.max(0, Math.min(100, (1 - progress) * 100)),
      durationMs,
    };
  }, [liveTick, nowMs, clock?.tick, clock?.tickEpochStartedAt, clock?.tickEpochDurationMs]);

  // Bar fill color: green → amber → red as season ages
  const barColor = seasonProgress < 0.5
    ? '#3f704d'
    : seasonProgress < 0.8
    ? '#d4a24c'
    : '#b23a48';

  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        height: 44,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '0 10px',
        background: 'rgba(10, 16, 10, 0.82)',
        borderBottom: '1px solid rgba(204, 170, 34, 0.3)',
        boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
        pointerEvents: 'none',
        zIndex: 5,
        fontFamily: '"VT323", "Courier New", monospace',
      }}
    >
      {/* Left: tick counter */}
      <div
        style={{
          color: GOLD,
          minWidth: 82,
          display: 'flex',
          flexDirection: 'column',
          gap: 3,
          flexShrink: 0,
        }}
      >
        <div
          key={liveTick}
          data-testid="top-hud-tick"
          style={{
            fontSize: 18,
            letterSpacing: '0.06em',
            lineHeight: 1,
            whiteSpace: 'nowrap',
            transformOrigin: 'left center',
            animation: 'cw-tick-pop 760ms ease-out',
          }}
        >
          tick {liveTick}
        </div>
        <div
          aria-hidden="true"
          style={{
            height: 3,
            width: '100%',
            background: 'rgba(212, 162, 76, 0.16)',
            border: '1px solid rgba(212, 162, 76, 0.18)',
            borderRadius: 2,
            overflow: 'hidden',
            boxShadow: 'inset 0 0 4px rgba(0,0,0,0.35)',
          }}
          title={`Approximate time until next tick: ${Math.round((tickCountdown.remainingPct / 100) * tickCountdown.durationMs / 1000)}s`}
        >
          <div
            style={{
              height: '100%',
              width: `${tickCountdown.remainingPct}%`,
              background: GOLD,
              borderRadius: 2,
              transition: 'width 250ms linear',
              boxShadow: `0 0 8px ${GOLD}aa`,
            }}
          />
        </div>
      </div>

      {/* Center: season progress */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
        <div
          style={{
            fontSize: 10,
            color: 'rgba(232, 216, 181, 0.55)',
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            fontFamily: 'monospace',
            lineHeight: 1,
          }}
        >
          season {seasonNumber}
        </div>
        {/* Progress bar */}
        <div
          style={{
            height: 5,
            background: 'rgba(255,255,255,0.08)',
            borderRadius: 2,
            overflow: 'hidden',
            border: '1px solid rgba(255,255,255,0.06)',
          }}
        >
          <div
            style={{
              height: '100%',
              width: `${Math.round(seasonProgress * 100)}%`,
              background: barColor,
              borderRadius: 2,
              transition: 'width 0.8s linear, background 1s ease',
              boxShadow: `0 0 6px ${barColor}88`,
            }}
          />
        </div>
      </div>

      {/* Right: status chips */}
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
        {/* Season progress percentage — sits adjacent to the bar so the
            season-progress group (bar + %) reads as a single unit. Event
            chips (winter / bandit) follow as separate right-aligned elements. */}
        <div
          style={{
            color: `${PARCHMENT}55`,
            fontSize: 11,
            fontFamily: 'monospace',
            letterSpacing: '0.04em',
          }}
        >
          {Math.round(seasonProgress * 100)}%
        </div>

        {/* Winter active */}
        {winterActive && (
          <div
            style={{
              padding: '1px 7px',
              background: 'rgba(100, 150, 220, 0.18)',
              border: '1px solid rgba(140, 180, 255, 0.45)',
              borderRadius: 3,
              color: '#a8c4ff',
              fontSize: 13,
              letterSpacing: '0.06em',
            }}
          >
            ❄ WINTER
          </div>
        )}

        {/* Winter approaching */}
        {!winterActive && winterWarning && (
          <div
            style={{
              padding: '1px 7px',
              background: 'rgba(100, 150, 220, 0.10)',
              border: '1px solid rgba(140, 180, 255, 0.28)',
              borderRadius: 3,
              color: 'rgba(168, 196, 255, 0.7)',
              fontSize: 12,
              letterSpacing: '0.04em',
            }}
          >
            ❄ winter soon
          </div>
        )}

        {/* Bandit warning */}
        {banditActive && (
          <div
            style={{
              padding: '1px 8px',
              background: 'rgba(178, 58, 72, 0.22)',
              border: `1px solid ${BANDIT_RED}88`,
              borderRadius: 3,
              color: BANDIT_RED,
              fontSize: 14,
              letterSpacing: '0.06em',
              animation: 'cw-bandit-pulse 0.9s ease-in-out infinite alternate',
            }}
          >
            ⚔ RAID IN {banditTicksUntil}
          </div>
        )}
      </div>

      <style>{`
        @keyframes cw-tick-pop {
          0% {
            transform: scale(1);
            text-shadow: 0 0 3px ${GOLD}44;
          }
          28% {
            transform: scale(1.24);
            text-shadow: 0 0 12px ${GOLD}cc, 0 0 24px ${GOLD}66;
          }
          100% {
            transform: scale(1);
            text-shadow: 0 0 3px ${GOLD}55;
          }
        }
        @keyframes cw-bandit-pulse {
          from { opacity: 0.7; box-shadow: 0 0 4px ${BANDIT_RED}44; }
          to   { opacity: 1;   box-shadow: 0 0 10px ${BANDIT_RED}88; }
        }
      `}</style>
    </div>
  );
}

// Lightweight version for contexts where we only have liveTick and no snapshot
// (e.g., used in cockpit header). Not exported — use TopHud directly.
void INK; // suppress unused import warning
