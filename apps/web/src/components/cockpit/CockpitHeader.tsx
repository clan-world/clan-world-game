import { useEffect, useRef, useState } from 'react';
import { useSafeQuery as useQuery } from '../../hooks/useSafeQuery';
import { api } from '../../../../server/convex/_generated/api';
import { tokens } from '../../styles/cockpit-tokens';
import { useConnectionStatus, type ConnectionStatus } from '../../hooks/useConnectionStatus';
import { BulletinFlyout } from './BulletinFlyout';

const MEMORY_WIPE_INTERVAL_TICKS = 10;

function useMemoryWipeCountdown(): {
  currentTick: number;
  ticksUntilWipe: number;
  intervalTicks: number;
} {
  const clock = useQuery(api.getTickClock.getTickClock);
  const tick = typeof clock?.tick === 'number' && Number.isFinite(clock.tick)
    ? clock.tick
    : 0;
  const remainder = tick % MEMORY_WIPE_INTERVAL_TICKS;
  const ticksUntilWipe = remainder === 0
    ? MEMORY_WIPE_INTERVAL_TICKS
    : MEMORY_WIPE_INTERVAL_TICKS - remainder;

  return {
    currentTick: tick,
    ticksUntilWipe,
    intervalTicks: MEMORY_WIPE_INTERVAL_TICKS,
  };
}

/**
 * App-level cockpit header — replaces the per-mini-cockpit chrome that used
 * to repeat the tick counter four times. Single instance now.
 *
 * Layout: title left, tick counter middle-right, connection pill far right.
 */
export function CockpitHeader() {
  const { currentTick, ticksUntilWipe, intervalTicks } = useMemoryWipeCountdown();
  const { status, retry } = useConnectionStatus();

  return (
    <header
      data-testid="cockpit-chrome"
      style={{
        height: '40px',
        background: tokens.bg.ironDeep,
        borderBottom: `1px solid ${tokens.border.iron}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: `0 ${tokens.space.md}`,
        flexShrink: 0,
        gap: tokens.space.md,
        position: 'relative',  // anchor for BulletinFlyout's absolute panel
      }}
    >
      <div
        style={{
          fontFamily: tokens.font.display,
          fontSize: '12px',
          letterSpacing: '0.24em',
          color: tokens.text.onIron,
          textTransform: 'uppercase',
          whiteSpace: 'nowrap',
        }}
      >
        Clan World Cockpit
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: tokens.space.md,
        }}
      >
        <TickCounter
          currentTick={currentTick}
          ticksUntilWipe={ticksUntilWipe}
          intervalTicks={intervalTicks}
        />
        <BulletinFlyout />
        <ConnectionPill status={status} onRetry={retry} />
      </div>
    </header>
  );
}

interface TickProps {
  currentTick: number;
  ticksUntilWipe: number;
  intervalTicks: number;
}

/**
 * Memory wipe countdown with a 200ms border-glow flash on each engine tick.
 */
function TickCounter({ currentTick, ticksUntilWipe, intervalTicks }: TickProps) {
  const [pulsing, setPulsing] = useState(false);
  const prevTickRef = useRef(currentTick);

  useEffect(() => {
    if (currentTick === prevTickRef.current) return;
    prevTickRef.current = currentTick;
    setPulsing(true);
    const t = setTimeout(() => setPulsing(false), 200);
    return () => clearTimeout(t);
  }, [currentTick]);

  return (
    <div
      data-testid="cockpit-header-tick"
      data-pulsing={pulsing}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        padding: '4px 10px',
        border: `1px solid ${pulsing ? tokens.text.accent : tokens.border.iron}`,
        borderRadius: tokens.radius.sm,
        background: tokens.bg.ink,
        boxShadow: pulsing
          ? `0 0 12px ${tokens.text.accent}, inset 0 0 6px rgba(212,165,68,0.25)`
          : 'none',
        fontFamily: tokens.font.mono,
        fontSize: '12px',
        color: tokens.text.accent,
        fontWeight: 600,
        letterSpacing: '0.08em',
        transition: 'box-shadow 200ms ease, border-color 200ms ease',
      }}
      title={`Memory wipe countdown. Current engine tick: ${currentTick}. Wipe interval: ${intervalTicks} ticks.`}
    >
      <span
        style={{
          opacity: 0.62,
          fontSize: '10px',
          textTransform: 'uppercase',
          whiteSpace: 'nowrap',
        }}
      >
        memory wipe
      </span>
      <span style={{ color: tokens.text.accent, whiteSpace: 'nowrap' }}>
        in {ticksUntilWipe}t
      </span>
      <span style={{ opacity: 0.45, fontSize: '10px', whiteSpace: 'nowrap' }}>
        tick {currentTick}
      </span>
    </div>
  );
}

interface PillProps {
  status: ConnectionStatus;
  onRetry: () => void;
}

const STATUS_COLORS: Record<ConnectionStatus, string> = {
  connected: '#7a8a6a',
  reconnecting: tokens.text.accent,
  disconnected: tokens.text.danger,
};

const STATUS_LABELS: Record<ConnectionStatus, string> = {
  connected: 'connected',
  reconnecting: 'reconnecting',
  disconnected: 'disconnected',
};

const STATUS_GLYPHS: Record<ConnectionStatus, string> = {
  connected: '●',
  reconnecting: '⟳',
  disconnected: '●',
};

/**
 * Connection state pill. Shows current heartbeat status with a glyph + label,
 * and exposes a manual "Reconnect" button when fully disconnected.
 */
function ConnectionPill({ status, onRetry }: PillProps) {
  const color = STATUS_COLORS[status];
  return (
    <div
      data-testid="cockpit-connection-pill"
      data-status={status}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        padding: '4px 10px',
        border: `1px solid ${tokens.border.iron}`,
        borderRadius: tokens.radius.sm,
        background: tokens.bg.ink,
        fontFamily: tokens.font.mono,
        fontSize: '11px',
        color: tokens.text.onIronDim,
        letterSpacing: '0.06em',
      }}
      title={`Cockpit backend: ${STATUS_LABELS[status]}`}
    >
      <span
        aria-hidden
        style={{
          color,
          fontSize: '13px',
          lineHeight: 1,
          display: 'inline-block',
          animation: status === 'reconnecting' ? 'cockpit-pill-spin 1.2s linear infinite' : undefined,
        }}
      >
        {STATUS_GLYPHS[status]}
      </span>
      <span style={{ color: tokens.text.onIron }}>{STATUS_LABELS[status]}</span>
      {status === 'disconnected' && (
        <button
          data-testid="cockpit-connection-pill-retry"
          type="button"
          onClick={onRetry}
          style={{
            marginLeft: '4px',
            padding: '2px 8px',
            border: `1px solid ${tokens.border.ironLight}`,
            borderRadius: tokens.radius.sm,
            background: 'transparent',
            color: tokens.text.accent,
            fontFamily: tokens.font.mono,
            fontSize: '10px',
            letterSpacing: '0.08em',
            cursor: 'pointer',
            textTransform: 'uppercase',
          }}
        >
          Reconnect
        </button>
      )}
      <style>{`
        @keyframes cockpit-pill-spin {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
