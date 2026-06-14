import { useState } from 'react';
import { useSafeQuery as useQuery } from '../../hooks/useSafeQuery';
import { useCurrentWorldTick } from '../../hooks/useCurrentWorldTick';
import { api } from '../../../../server/convex/_generated/api';
import { tokens, ELDERS } from '../../styles/cockpit-tokens';
import type { ElderDef } from '../../styles/cockpit-tokens';
import {
  CLAN_ACCENT,
  VISIBLE_TICKS,
  VisibilityChip,
  OldBulletinSeparator,
  hexToRgba,
  darken,
  fadeOpacity,
} from './tabs/CommsTab';

interface BulletinPost {
  tick: number;
  body: string;
}

const STUB_BY_CLAN: Record<number, BulletinPost[]> = {
  1: [
    { tick: 6, body: 'STORM RIDERS DECLARE: forest sweep tick T07. Allied clans welcome.' },
    { tick: 5, body: '"Speed wins what stillness loses." — Aldric.' },
    { tick: 4, body: 'Patrols out from west bank. Two travelers tracked, non-hostile.' },
    { tick: 2, body: 'Open call for ore — willing to trade favor in T09 raid.' },
    { tick: 0, body: 'Storm Riders enter the season. May winds favor the bold.' },
  ],
  2: [
    { tick: 6, body: 'IRON GUARD POSTS: vault at 240 ore / 180 wood. Trade window open.' },
    { tick: 5, body: 'Trade counter posted: ore for wood at 3:1.' },
    { tick: 4, body: 'No raid commitment T07. Defensive posture maintained.' },
    { tick: 2, body: 'Cautious accumulation continues. Stockpile is freedom.' },
    { tick: 0, body: 'Iron Guard begins T0 with patient resolve.' },
  ],
  3: [
    { tick: 6, body: 'CRIMSON: opportunistic raid eyed for T08. Watch the forest.' },
    { tick: 4, body: 'Volatility is a weapon. The patient miss the moment.' },
    { tick: 2, body: 'Crimson holds — but only because the moment is wrong.' },
    { tick: 0, body: 'Crimson colors raised. Watch the markets.' },
  ],
  4: [
    { tick: 6, body: 'VERDANT WARDENS: orchard rotation steady. Five-tick yield curve holds.' },
    { tick: 5, body: 'Scout report posted: north pass clear of hostiles.' },
    { tick: 3, body: 'Long view: investing two ticks of wood toward T10 surplus.' },
    { tick: 1, body: 'Wardens accept all incoming whispers. We answer in kind.' },
    { tick: 0, body: 'Verdant Wardens take the field. The patient inherit.' },
  ],
};

function getInitialOpen(): boolean {
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).get('bulletin-open') === '1';
}

/**
 * Cross-clan public bulletin board. 50%-width flyout from chrome with title +
 * subtitle in the display font and a 2×2 grid of clan-cards (corner-bracketed
 * like landing path-cards). Each card splits its posts visible-then-OLD with
 * a separator line.
 */
export function BulletinFlyout() {
  const [open, setOpen] = useState<boolean>(() => getInitialOpen());

  return (
    <>
      <button
        type="button"
        data-testid="cockpit-bulletin-toggle"
        onClick={() => setOpen(o => !o)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          padding: '4px 10px',
          border: `1px solid ${open ? tokens.text.accent : tokens.border.iron}`,
          borderRadius: tokens.radius.sm,
          background: open ? hexToRgba('#d4a544', 0.10) : tokens.bg.ink,
          fontFamily: tokens.font.mono,
          fontSize: '11px',
          color: open ? tokens.text.accent : tokens.text.onIronDim,
          letterSpacing: '0.06em',
          cursor: 'pointer',
          textTransform: 'uppercase',
        }}
        title="Public bulletin board — all clans"
      >
        <span style={{ fontSize: '13px', lineHeight: 1 }}>📋</span>
        <span style={{ color: open ? tokens.text.accent : tokens.text.onIron }}>Public Bulletin</span>
      </button>

      {open && <BulletinPanel onClose={() => setOpen(false)} />}
    </>
  );
}

function BulletinPanel({ onClose }: { onClose: () => void }) {
  return (
    <div
      data-testid="cockpit-bulletin-panel"
      style={{
        position: 'absolute',
        top: '40px',
        left: '50%',
        transform: 'translateX(-50%)',
        width: '50%',
        height: 'min(50vh, 600px)',
        background: tokens.bg.parchment,
        border: `1.5px solid ${tokens.bg.ink}`,
        borderTop: 'none',
        boxShadow: '0 8px 24px rgba(0,0,0,0.55)',
        zIndex: 50,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      <PanelHeader onClose={onClose} />
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: tokens.space.md,
          display: 'grid',
          gridTemplateColumns: 'repeat(2, 1fr)',
          gridTemplateRows: 'repeat(2, 1fr)',
          gap: tokens.space.md,
          minHeight: 0,
        }}
      >
        {ELDERS.map(elder => (
          <ClanBulletinCard key={elder.clanId} elder={elder} />
        ))}
      </div>
    </div>
  );
}

function PanelHeader({ onClose }: { onClose: () => void }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        padding: `${tokens.space.md} ${tokens.space.lg}`,
        borderBottom: `1px solid ${tokens.border.parchmentEdge}`,
        background: tokens.bg.parchmentDim,
      }}
    >
      <div>
        <h2
          style={{
            margin: 0,
            fontFamily: tokens.font.display,
            fontSize: '17px',
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
            color: tokens.text.onParchment,
            lineHeight: 1.1,
          }}
        >
          Unicorn Town Public Bulletin Board
        </h2>
        <div
          style={{
            marginTop: '3px',
            fontFamily: tokens.font.mono,
            fontSize: '9px',
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
            color: tokens.text.onParchmentDim,
          }}
        >
          Public clan bulletins
        </div>
      </div>
      <button
        type="button"
        onClick={onClose}
        aria-label="Close bulletin"
        style={{
          background: 'transparent',
          border: 'none',
          color: tokens.text.onParchmentDim,
          fontSize: '16px',
          cursor: 'pointer',
          padding: '0 6px',
          lineHeight: 1,
        }}
      >
        ✕
      </button>
    </div>
  );
}

function ClanBulletinCard({ elder }: { elder: ElderDef }) {
  const accent = CLAN_ACCENT[elder.clanId] ?? '#5a8aa8';
  const currentTick = useCurrentWorldTick();
  // Live per-clan bulletins; stub fallback when feed is cold (initial load
  // or empty backend during demo prep).
  const live = useQuery(api.bulletins.getByClan, { clanId: elder.clanId });
  const posts: BulletinPost[] =
    live === undefined || live.length === 0
      ? (STUB_BY_CLAN[elder.clanId] ?? [])
      : live.map(b => ({ tick: b.slot, body: b.body }));
  const visible = posts.filter(p => currentTick - p.tick <= VISIBLE_TICKS);
  const old = posts.filter(p => currentTick - p.tick > VISIBLE_TICKS);

  return (
    <div
      data-testid={`bulletin-card-clan-${elder.clanId}`}
      style={{
        position: 'relative',
        background: tokens.bg.parchment,
        border: `1.5px solid ${tokens.bg.ink}`,
        padding: `${tokens.space.md} ${tokens.space.md} ${tokens.space.sm}`,
        display: 'flex',
        flexDirection: 'column',
        gap: tokens.space.sm,
        minHeight: 0,
        overflow: 'hidden',
      }}
    >
      {/* Corner brackets — match landing path-card styling. Top-left + bottom-right. */}
      <span
        aria-hidden
        style={{
          position: 'absolute', top: '-7px', left: '-7px',
          width: '18px', height: '18px',
          borderTop: `1.5px solid ${tokens.text.accent}`,
          borderLeft: `1.5px solid ${tokens.text.accent}`,
          pointerEvents: 'none',
        }}
      />
      <span
        aria-hidden
        style={{
          position: 'absolute', bottom: '-7px', right: '-7px',
          width: '18px', height: '18px',
          borderBottom: `1.5px solid ${tokens.text.accent}`,
          borderRight: `1.5px solid ${tokens.text.accent}`,
          pointerEvents: 'none',
        }}
      />

      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          paddingBottom: '4px',
          borderBottom: `1px solid ${accent}`,
        }}
      >
        <span style={{ fontSize: '14px', color: accent }}>{elder.glyph}</span>
        <span
          style={{
            fontFamily: tokens.font.display,
            fontSize: '11px',
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
            color: darken(accent),
            fontWeight: 700,
          }}
        >
          {elder.name}
        </span>
      </header>

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '4px',
          overflowY: 'auto',
          minHeight: 0,
          flex: 1,
        }}
      >
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '4px' }}>
          {visible.map((p, i) => (
            <BulletinCardRow key={`v-${i}`} post={p} accent={accent} currentTick={currentTick} />
          ))}
        </ul>
        {old.length > 0 && (
          <>
            <OldBulletinSeparator />
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {old.map((p, i) => (
                <BulletinCardRow key={`o-${i}`} post={p} accent={accent} currentTick={currentTick} />
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}

function BulletinCardRow({ post, accent, currentTick }: { post: BulletinPost; accent: string; currentTick: number }) {
  const isVisible = (currentTick - post.tick) <= VISIBLE_TICKS;
  const opacity = fadeOpacity(post.tick, currentTick);
  return (
    <li
      data-visible={isVisible}
      style={{
        background: hexToRgba(accent, 0.1),
        borderLeft: `2px solid ${accent}`,
        padding: '4px 6px',
        fontSize: '10px',
        display: 'flex',
        flexDirection: 'column',
        gap: '2px',
        opacity,
        transition: 'opacity 200ms ease',
      }}
    >
      {/* Top row: empty-left, right-aligned (chip + tick), so visibility chip
          sits BESIDE the tick number — Liam directive: match per-tab layout. */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-end',
          gap: '6px',
          fontFamily: tokens.font.mono,
          fontSize: '8px',
          letterSpacing: '0.10em',
          color: tokens.text.muted,
        }}
      >
        <VisibilityChip visible={isVisible} />
        <span>T{post.tick}</span>
      </div>
      <div style={{ color: tokens.text.onParchment, lineHeight: 1.35 }}>{post.body}</div>
    </li>
  );
}
