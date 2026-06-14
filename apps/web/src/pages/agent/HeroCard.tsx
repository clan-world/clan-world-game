import { agentTokens as t, type AgentDef } from './agent-tokens';

interface Props {
  agent: AgentDef;
  /** Wallet hex prefix shown next to the tkn id. */
  walletPrefix?: string;
  /** Tick at which this NFT was sealed/minted. */
  sealedTick?: number;
  /** Stats shown beneath the divider. */
  ownedTicks?: number;
  memoryKeys?: number;
  hires?: number;
}

/**
 * Parchment-letter hero card — the "writ" of the NFT. Ports the slice-1
 * NFT detail hero:
 *  - parchment gradient with noise multiply overlay
 *  - top row: tkn id + name + archetype on the left, clan-pill on the right
 *  - centred sigil (140 × 140)
 *  - "— sealed tick {N} —" stamp in Uncial Antiqua
 *  - lozenge divider
 *  - 3-stat grid (Owned · Memory · Hires)
 */
export function HeroCard({
  agent,
  walletPrefix = '0x71f2',
  sealedTick = 148,
  ownedTicks = 279,
  memoryKeys = 42,
  hires = 2,
}: Props) {
  return (
    <article
      data-testid="hero-card"
      data-agent-id={agent.id}
      style={{
        position: 'relative',
        margin: '0 22px',
        background:
          `linear-gradient(150deg, ${t.parchment.base} 0%, ${t.parchment.mid} 70%, ${t.parchment.shade} 100%)`,
        borderRadius: '8px',
        padding: '24px 22px 22px',
        color: t.ink.primary,
        overflow: 'hidden',
        boxShadow:
          'inset 0 0 0 1px rgba(42,31,16,0.12), 0 18px 36px -18px rgba(0,0,0,0.7)',
      }}
    >
      {/* Parchment grain — multiply noise overlay */}
      <span
        aria-hidden
        style={{
          position: 'absolute',
          inset: 0,
          background: `url("${noiseDataUri}")`,
          mixBlendMode: 'multiply',
          opacity: 0.55,
          pointerEvents: 'none',
          borderRadius: '8px',
        }}
      />

      {/* Top row */}
      <header
        style={{
          position: 'relative',
          zIndex: 2,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: '14px',
        }}
      >
        <div>
          <div
            style={{
              fontFamily: t.font.mono,
              fontSize: '10px',
              letterSpacing: '0.32em',
              color: t.ink.tertiary,
              textTransform: 'uppercase',
            }}
          >
            tkn {walletPrefix} · agent
          </div>
          <div
            style={{
              fontFamily: t.font.display,
              fontSize: '26px',
              color: t.ink.primary,
              letterSpacing: '0.04em',
              fontWeight: 600,
              marginTop: '2px',
              lineHeight: 1.05,
            }}
          >
            {agent.name}
          </div>
          <div
            style={{
              fontFamily: t.font.script,
              fontStyle: 'italic',
              color: t.ink.secondary,
              fontSize: '14px',
              marginTop: '4px',
            }}
          >
            {agent.archetype.toLowerCase()}, {agent.oneLineEssence}
          </div>
        </div>
        <ClanPill agent={agent} />
      </header>

      {/* Sigil */}
      <div
        style={{
          position: 'relative',
          zIndex: 2,
          margin: '18px auto 14px',
          width: '140px',
          height: '140px',
          color: agent.accent,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <svg
          viewBox="0 0 140 140"
          width="140"
          height="140"
          aria-hidden
          style={{ position: 'absolute', inset: 0 }}
        >
          {/* Outer ring */}
          <circle
            cx="70"
            cy="70"
            r="64"
            fill="none"
            stroke="currentColor"
            strokeOpacity="0.20"
            strokeWidth="1"
          />
          {/* Inner notched ring */}
          <circle
            cx="70"
            cy="70"
            r="50"
            fill="none"
            stroke="currentColor"
            strokeOpacity="0.45"
            strokeWidth="1"
            strokeDasharray="3 5"
          />
          {/* Diamond outline */}
          <path
            d="M70 22 L118 70 L70 118 L22 70 Z"
            fill="none"
            stroke="currentColor"
            strokeOpacity="0.55"
            strokeWidth="1.25"
          />
        </svg>
        <span
          aria-hidden
          style={{
            fontFamily: t.font.display,
            fontSize: '64px',
            color: agent.accent,
            zIndex: 1,
            filter: 'drop-shadow(0 2px 0 rgba(42,31,16,0.18))',
          }}
        >
          {agent.glyph}
        </span>
      </div>

      {/* Sealed-tick stamp */}
      <div
        style={{
          position: 'relative',
          zIndex: 2,
          textAlign: 'center',
          fontFamily: t.font.rune,
          fontSize: '13px',
          color: t.ink.secondary,
          letterSpacing: '0.32em',
          textTransform: 'lowercase',
        }}
      >
        — sealed tick {String(sealedTick).padStart(4, '0')} —
      </div>

      {/* Lozenge divider */}
      <div
        style={{
          position: 'relative',
          zIndex: 2,
          margin: '14px 0',
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          color: t.ink.secondary,
        }}
      >
        <span style={dividerLine} />
        <span aria-hidden style={lozenge} />
        <span style={dividerLine} />
      </div>

      {/* Stats grid */}
      <div
        style={{
          position: 'relative',
          zIndex: 2,
          display: 'grid',
          gridTemplateColumns: '1fr 1fr 1fr',
          gap: '10px',
        }}
      >
        <Stat label="Owned" value={`${ownedTicks} ticks`} />
        <Stat label="Memory" value={`${memoryKeys} keys`} />
        <Stat label="Hires" value={String(hires).padStart(2, '0')} />
      </div>
    </article>
  );
}

function ClanPill({ agent }: { agent: AgentDef }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        fontFamily: t.font.mono,
        fontSize: '10px',
        letterSpacing: '0.18em',
        color: '#fff',
        background: agent.accent,
        padding: '4px 10px',
        borderRadius: '99px',
        textTransform: 'uppercase',
        boxShadow: 'inset 0 -2px 4px rgba(0,0,0,0.25)',
      }}
    >
      House {numerals(agent.id)}
    </span>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '2px',
        textAlign: 'center',
      }}
    >
      <span
        style={{
          fontFamily: t.font.mono,
          fontSize: '9px',
          color: t.ink.tertiary,
          letterSpacing: '0.28em',
          textTransform: 'uppercase',
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontFamily: t.font.display,
          fontSize: '13px',
          color: t.ink.primary,
          fontWeight: 600,
          letterSpacing: '0.04em',
        }}
      >
        {value}
      </span>
    </div>
  );
}

const dividerLine: React.CSSProperties = {
  flex: 1,
  height: '1px',
  background: 'rgba(42,31,16,0.30)',
};

const lozenge: React.CSSProperties = {
  width: '5px',
  height: '5px',
  background: 'currentColor',
  transform: 'rotate(45deg)',
};

function numerals(n: number): string {
  return ['i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii'][n - 1] ?? String(n);
}

/** Pre-baked SVG noise — same recipe as slice-1's `.hero::after`. */
const noiseDataUri =
  "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'>" +
  "<filter id='pg'><feTurbulence type='fractalNoise' baseFrequency='0.7' numOctaves='2' stitchTiles='stitch'/>" +
  "<feColorMatrix values='0 0 0 0 0.16  0 0 0 0 0.12  0 0 0 0 0.06  0 0 0 0.10 0'/></filter>" +
  "<rect width='100%' height='100%' filter='url(%23pg)'/></svg>";
