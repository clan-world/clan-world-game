import { useEffect, useState } from 'react';
import { tokens } from '../../styles/cockpit-tokens';
import type { ElderDef } from '../../styles/cockpit-tokens';
import { RESET_OVERLAY_MAX_DISPLAY_MS } from './resetOverlayState';

interface Props {
  elder: ElderDef;
  testIdPrefix: string;
  isExiting: boolean;
  onReconnect: () => void;
}

const SHARDS = [
  { left: '14%', top: '24%', delay: '0ms', size: '7px' },
  { left: '24%', top: '68%', delay: '160ms', size: '5px' },
  { left: '40%', top: '18%', delay: '320ms', size: '6px' },
  { left: '58%', top: '74%', delay: '480ms', size: '5px' },
  { left: '70%', top: '28%', delay: '640ms', size: '8px' },
  { left: '84%', top: '58%', delay: '800ms', size: '6px' },
];

export function ElderResetOverlay({ elder, testIdPrefix, isExiting, onReconnect }: Props) {
  const [takingLong, setTakingLong] = useState(false);

  useEffect(() => {
    setTakingLong(false);
    const timer = window.setTimeout(() => {
      setTakingLong(true);
    }, RESET_OVERLAY_MAX_DISPLAY_MS);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <div
      data-testid={`${testIdPrefix}-elder-reset-overlay`}
      data-exiting={isExiting}
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 4,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        background: `radial-gradient(circle at 50% 42%, ${elder.accent}30 0%, rgba(0,0,0,0.9) 44%, rgba(0,0,0,0.97) 100%)`,
        borderTop: `1px solid ${elder.accent}`,
        color: tokens.text.onIron,
        fontFamily: tokens.font.mono,
        pointerEvents: 'auto',
        animation: isExiting
          ? 'cw-reset-overlay-out 320ms ease forwards'
          : 'cw-reset-overlay-in 180ms ease forwards',
      }}
      aria-live="polite"
    >
      <style>{`
        @keyframes cw-reset-overlay-in {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes cw-reset-overlay-out {
          from { opacity: 1; }
          to { opacity: 0; }
        }
        @keyframes cw-reset-core-pulse {
          0%, 100% { opacity: 0.62; transform: scale(0.96); }
          50% { opacity: 1; transform: scale(1.04); }
        }
        @keyframes cw-reset-shard-drift {
          0% { opacity: 0; transform: translate3d(0, 10px, 0) rotate(0deg); }
          35% { opacity: 0.72; }
          100% { opacity: 0; transform: translate3d(0, -18px, 0) rotate(42deg); }
        }
        @media (prefers-reduced-motion: reduce) {
          [data-testid="${testIdPrefix}-elder-reset-overlay"] {
            animation: none !important;
          }
          [data-testid="${testIdPrefix}-elder-reset-overlay"] [data-reset-animated="true"] {
            animation: none !important;
          }
        }
      `}</style>

      {SHARDS.map((shard, idx) => (
        <span
          key={idx}
          data-reset-animated="true"
          aria-hidden
          style={{
            position: 'absolute',
            left: shard.left,
            top: shard.top,
            width: shard.size,
            height: shard.size,
            border: `1px solid ${elder.accent}`,
            background: `${elder.accent}28`,
            boxShadow: `0 0 12px ${elder.accent}66`,
            transform: 'rotate(45deg)',
            animation: `cw-reset-shard-drift 2.4s ease-in-out ${shard.delay} infinite`,
          }}
        />
      ))}

      <div
        style={{
          width: 'min(88%, 360px)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: tokens.space.md,
          padding: tokens.space.lg,
          textAlign: 'center',
        }}
      >
        <div
          data-reset-animated="true"
          aria-hidden
          style={{
            width: '58px',
            height: '58px',
            display: 'grid',
            placeItems: 'center',
            border: `1px solid ${elder.accent}`,
            borderRadius: tokens.radius.md,
            background: `linear-gradient(135deg, ${elder.accent}24, rgba(0,0,0,0.72))`,
            boxShadow: `0 0 26px ${elder.accent}55, inset 0 0 18px rgba(0,0,0,0.7)`,
            color: elder.accent,
            fontFamily: tokens.font.display,
            fontSize: '30px',
            lineHeight: 1,
            animation: 'cw-reset-core-pulse 1.45s ease-in-out infinite',
          }}
        >
          {elder.glyph}
        </div>
        <div
          style={{
            color: tokens.text.onIron,
            fontSize: '12px',
            letterSpacing: '0.08em',
            lineHeight: 1.55,
            textTransform: 'uppercase',
          }}
        >
          Elder {elder.name} is being reset.
          <br />
          Memory wipe in progress.
        </div>
        {takingLong && (
          <div
            data-testid={`${testIdPrefix}-elder-reset-long`}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: tokens.space.sm,
              color: tokens.text.onIronDim,
              fontSize: '10px',
              letterSpacing: '0.06em',
              lineHeight: 1.45,
              textTransform: 'uppercase',
            }}
          >
            <span>Reset taking longer than expected.</span>
            <button
              type="button"
              onClick={onReconnect}
              style={{
                border: `1px solid ${tokens.border.ironLight}`,
                borderRadius: tokens.radius.sm,
                background: 'rgba(0,0,0,0.45)',
                color: tokens.text.accent,
                cursor: 'pointer',
                fontFamily: tokens.font.mono,
                fontSize: '10px',
                letterSpacing: '0.08em',
                padding: '4px 8px',
                textTransform: 'uppercase',
              }}
            >
              Retry
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
