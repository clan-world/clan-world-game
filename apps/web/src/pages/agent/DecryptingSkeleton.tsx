import { useEffect, useRef, useState } from 'react';
import { agentTokens as t } from './agent-tokens';

interface Props {
  /** Approximate height of the surface being decrypted (px). */
  height: number;
  /** Optional override label for the loading ritual. */
  label?: string;
}

const RUNES = 'ᚠᚢᚦᚨᚱᚲᚷᚹᚺᚾᛁᛃᛇᛉᛊᛏᛒᛖᛗᛚᛜᛞᛟᚦᛏᛁᛒᛟᛒᛖᛞᚷᚹᚺᛇ◈◉◊⟁⟁⟢';

/**
 * Skeleton that reads like a *ritual*, not a generic shimmer.
 *
 * Animation strategy:
 *   - 6 horizontal "strips" of randomized rune characters, each shifting
 *     at slightly different intervals so the eye reads scrolling glyph noise.
 *   - A faint cyan scan line glides vertically over the strips.
   *   - Center-bottom caption pulses with
 *     a trailing spinner glyph.
 */
export function DecryptingSkeleton({ height, label = 'Decrypting agent memory' }: Props) {
  const [strips, setStrips] = useState<string[]>(() => buildStrips(6, 32));
  const lastTickRef = useRef(0);

  useEffect(() => {
    let raf = 0;
    const tick = (now: number) => {
      // Shuffle strips ~every 90ms — fast enough to look encrypted, not seizure-y.
      if (now - lastTickRef.current > 90) {
        setStrips(buildStrips(6, 32));
        lastTickRef.current = now;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div
      data-testid="decrypting-skeleton"
      style={{
        position: 'relative',
        width: '100%',
        height: `${height}px`,
        background: t.bg.obsidian,
        border: `1px solid ${t.border.iron}`,
        borderRadius: t.radius.md,
        overflow: 'hidden',
        boxShadow: 'inset 0 0 16px rgba(0,0,0,0.6)',
      }}
      aria-busy="true"
      aria-label="decrypting"
    >
      <style>{`
        @keyframes scanGlide {
          0%   { transform: translateY(-110%); }
          100% { transform: translateY(110%); }
        }
        @keyframes captionPulse {
          0%, 100% { opacity: 0.55; }
          50%      { opacity: 1; }
        }
        @keyframes spinDot {
          0%, 100% { content: ''; }
          25%      { content: '·'; }
          50%      { content: '··'; }
          75%      { content: '···'; }
        }
      `}</style>

      {/* Glyph noise strips */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          padding: '6px 8px',
          display: 'flex',
          flexDirection: 'column',
          gap: '5px',
          opacity: 0.34,
        }}
      >
        {strips.map((s, i) => (
          <div
            key={i}
            style={{
              fontFamily: t.font.mono,
              fontSize: i % 2 === 0 ? '10px' : '11px',
              color: i % 3 === 0 ? t.rune.core : t.text.secondary,
              letterSpacing: '0.06em',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'clip',
              opacity: 0.4 + (i % 4) * 0.15,
            }}
          >
            {s}
          </div>
        ))}
      </div>

      {/* Vertical scan line */}
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: 0,
          height: '34%',
          background: `linear-gradient(180deg, transparent 0%, rgba(95,197,212,0.1) 45%, rgba(95,197,212,0.18) 50%, rgba(95,197,212,0.1) 55%, transparent 100%)`,
          animation: 'scanGlide 2.4s linear infinite',
          pointerEvents: 'none',
        }}
      />

      {/* Center caption */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'column',
          gap: '6px',
          textAlign: 'center',
          padding: '0 16px',
          pointerEvents: 'none',
        }}
      >
        <div
          style={{
            fontFamily: t.font.rune,
            fontSize: '20px',
            color: t.rune.glow,
            textShadow: `0 0 12px ${t.rune.core}`,
            letterSpacing: '0.04em',
          }}
        >
          ⟁ ◈ ⟁
        </div>
        <div
          style={{
            fontFamily: t.font.body,
            fontSize: '10px',
            color: t.rune.core,
            letterSpacing: '0.34em',
            textTransform: 'uppercase',
            animation: 'captionPulse 1.6s ease-in-out infinite',
          }}
        >
          {label}…
        </div>
      </div>
    </div>
  );
}

function buildStrips(rows: number, cols: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < rows; i++) {
    let s = '';
    for (let j = 0; j < cols; j++) s += RUNES[Math.floor(Math.random() * RUNES.length)];
    out.push(s);
  }
  return out;
}
