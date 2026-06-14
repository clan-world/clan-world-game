import { useState } from 'react';
import { useSafeQuery as useQuery } from '../../../hooks/useSafeQuery';
import { useCurrentWorldTick } from '../../../hooks/useCurrentWorldTick';
import { api } from '../../../../../server/convex/_generated/api';
import { tokens, ELDERS } from '../../../styles/cockpit-tokens';
import type { ElderDef } from '../../../styles/cockpit-tokens';

interface Props {
  elder: ElderDef;
  testIdPrefix: string;
}

type CommsKind = 'whisper' | 'human' | 'orch';
type CommsView = 'axl' | 'bulletin';

interface CommsLine {
  tick: number;
  kind: CommsKind;
  speaker: string;          // 'orchestrator' | 'owner' | 'clan-N'
  body: string;
  recipients?: number[];    // whisper-only: which clans the sender targeted
}

interface BulletinPost {
  tick: number;
  speaker: string;
  body: string;
}

export const VISIBLE_TICKS = 4;

export const CLAN_ACCENT: Record<number, string> = {
  1: '#5a8aa8', 2: '#7a8a6a', 3: '#a85a5a', 4: '#6aa888',
};

const ORCH_GREY = '#5a5a5a';      // medium-dark grey for "world event" chip
const WORLD_EVENT_CHIP_BG = '#4a4a4a';

function speakerToClanId(speaker: string): number | null {
  const m = speaker.match(/^clan-(\d+)$/);
  return m ? Number(m[1]) : null;
}

function classLabelStyles(kind: CommsKind, speakerClanId: number | null): {
  label: string;
  bg: string;
  border: string;
  fg: string;
} {
  if (kind === 'orch') {
    return { label: 'ORCH', bg: 'rgba(138,138,138,0.10)', border: ORCH_GREY, fg: '#5a5a5a' };
  }
  if (kind === 'human') {
    return { label: 'HUMAN', bg: 'rgba(212,165,68,0.14)', border: '#b8862e', fg: '#7a4e10' };
  }
  const accent = (speakerClanId && CLAN_ACCENT[speakerClanId]) || '#5a8aa8';
  return {
    label: 'WHISPER',
    bg: hexToRgba(accent, 0.12),
    border: accent,
    fg: darken(accent),
  };
}

export function hexToRgba(hex: string, a: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}

export function darken(hex: string): string {
  const h = hex.replace('#', '');
  const r = Math.max(0, parseInt(h.slice(0, 2), 16) - 60);
  const g = Math.max(0, parseInt(h.slice(2, 4), 16) - 60);
  const b = Math.max(0, parseInt(h.slice(4, 6), 16) - 60);
  return `rgb(${r},${g},${b})`;
}

/** Mix hex toward white by `amount` (0..1). 0 = original, 1 = white. */
export function lighten(hex: string, amount: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const lr = Math.round(r + (255 - r) * amount);
  const lg = Math.round(g + (255 - g) * amount);
  const lb = Math.round(b + (255 - b) * amount);
  return `rgb(${lr},${lg},${lb})`;
}

export function fadeOpacity(tick: number, currentTick: number): number {
  const distance = Math.max(0, currentTick - tick);
  return Math.max(0.4, 1 - distance * 0.12);
}

function getInitialView(clanId: number): CommsView {
  if (typeof window === 'undefined') return 'axl';
  const params = new URLSearchParams(window.location.search);
  const v = params.get(`clan-${clanId}-view`);
  return v === 'bulletin' ? 'bulletin' : 'axl';
}

export function CommsTab({ elder, testIdPrefix }: Props) {
  const [view, setView] = useState<CommsView>(() => getInitialView(elder.clanId));
  return (
    <div
      data-testid={`${testIdPrefix}-content-comms`}
      style={{
        flex: 1,
        background: tokens.bg.parchment,
        color: tokens.text.onParchment,
        padding: tokens.space.md,
        overflowY: 'auto',
        fontFamily: tokens.font.body,
        display: 'flex',
        flexDirection: 'column',
        gap: tokens.space.sm,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-end',
          justifyContent: 'space-between',
          gap: tokens.space.md,
          borderBottom: `1px solid ${tokens.border.parchmentEdge}`,
          paddingBottom: '4px',
        }}
      >
        <h3
          style={{
            margin: 0,
            fontFamily: tokens.font.display,
            fontSize: '11px',
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
            color: tokens.text.onParchmentDim,
          }}
        >
          Comms — Elder {elder.clanId}
        </h3>
        <ViewToggle view={view} setView={setView} testIdPrefix={testIdPrefix} />
      </div>

      {view === 'axl' ? (
        <AxlView elder={elder} testIdPrefix={testIdPrefix} />
      ) : (
        <BulletinView elder={elder} testIdPrefix={testIdPrefix} />
      )}
    </div>
  );
}

function ViewToggle({
  view, setView, testIdPrefix,
}: { view: CommsView; setView: (v: CommsView) => void; testIdPrefix: string }) {
  return (
    <div
      role="tablist"
      data-testid={`${testIdPrefix}-comms-toggle`}
      style={{
        display: 'flex',
        border: `1px solid ${tokens.border.parchmentEdge}`,
        borderRadius: tokens.radius.sm,
        overflow: 'hidden',
        fontFamily: tokens.font.mono,
      }}
    >
      <ToggleButton
        active={view === 'axl'}
        label="Private"
        sublabel="private"
        onClick={() => setView('axl')}
        testId={`${testIdPrefix}-comms-toggle-axl`}
      />
      <ToggleButton
        active={view === 'bulletin'}
        label="Bulletin"
        sublabel="public"
        onClick={() => setView('bulletin')}
        testId={`${testIdPrefix}-comms-toggle-bulletin`}
      />
    </div>
  );
}

function ToggleButton({
  active, label, sublabel, onClick, testId,
}: { active: boolean; label: string; sublabel: string; onClick: () => void; testId: string }) {
  return (
    <button
      type="button"
      data-testid={testId}
      data-active={active}
      onClick={onClick}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '1px',
        padding: '3px 8px',
        background: active ? tokens.text.accent : 'transparent',
        color: active ? tokens.bg.ink : tokens.text.onParchmentDim,
        border: 'none',
        cursor: 'pointer',
        minWidth: '70px',
      }}
    >
      <span style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '0.08em' }}>{label}</span>
      <span style={{ fontSize: '8px', opacity: 0.7, letterSpacing: '0.12em', textTransform: 'uppercase' }}>{sublabel}</span>
    </button>
  );
}

function AxlView({ elder, testIdPrefix }: Props) {
  const live = useQuery(api.comms.getCombinedComms, { clanId: elder.clanId });
  const currentTick = useCurrentWorldTick();
  const lines: CommsLine[] = (live ?? []).map(l => ({
    tick: l.tick,
    kind: l.kind,
    speaker: l.speaker,
    body: l.body,
    recipients: l.kind === 'whisper' ? l.recipients : undefined,
  }));

  return (
    <ul
      data-testid={`${testIdPrefix}-comms-axl-list`}
      style={{
        listStyle: 'none',
        margin: 0,
        padding: 0,
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
      }}
    >
      {lines.map((l, i) => (
        <CommsBubble key={i} line={l} elder={elder} testIdPrefix={testIdPrefix} index={i} currentTick={currentTick} />
      ))}
    </ul>
  );
}

function CommsBubble({
  line, elder, testIdPrefix, index, currentTick,
}: { line: CommsLine; elder: ElderDef; testIdPrefix: string; index: number; currentTick: number }) {
  const speakerClanId = speakerToClanId(line.speaker);
  const styles = classLabelStyles(line.kind, speakerClanId);

  const isSelf = line.kind === 'whisper' && speakerClanId === elder.clanId;
  const isHuman = line.kind === 'human';
  const isOrch = line.kind === 'orch';
  const isFramed = isSelf || isHuman;

  const myAccent = CLAN_ACCENT[elder.clanId] ?? '#5a8aa8';
  const leftBarColor = isHuman ? myAccent : styles.border;
  const bgColor = isHuman ? hexToRgba(myAccent, 0.12) : styles.bg;
  const frameBorder = isFramed ? `1px solid ${myAccent}` : 'none';

  const opacity = fadeOpacity(line.tick, currentTick);

  return (
    <li
      data-testid={`${testIdPrefix}-comms-${line.kind}-${index}`}
      style={{
        alignSelf: 'stretch',
        background: bgColor,
        borderLeft: `3px solid ${leftBarColor}`,
        borderTop: frameBorder,
        borderRight: frameBorder,
        borderBottom: frameBorder,
        padding: '6px 8px',
        fontSize: '11px',
        display: 'flex',
        flexDirection: 'column',
        gap: '3px',
        opacity,
        transition: 'opacity 200ms ease',
      }}
    >
      {/*
        Header row layout (3-col grid):
          - HUMAN: [empty]  [centered "[HUMAN] owner"]  [steering-message chip + tick]
          - ORCH:  [empty]  [centered "[ORCH] orchestrator"]  [world-event chip + tick]
          - WHISPER (peer): [speaker on left] [—] [tick on right]
          - WHISPER (self): [speaker on left] [—] [sent-to chips + tick on right]
      */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr auto 1fr',
          alignItems: 'center',
          fontFamily: tokens.font.mono,
          fontSize: '9px',
          letterSpacing: '0.12em',
          gap: '6px',
        }}
      >
        {/* LEFT cell: whisper speaker label + sent-to chips (self only) */}
        <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-start', gap: '6px' }}>
          {!isHuman && !isOrch && (
            <span style={{ color: styles.fg, fontWeight: 700 }}>
              [{styles.label}] {line.speaker}
            </span>
          )}
          {isSelf && line.recipients && line.recipients.length > 0 && (
            <SentToChips recipients={line.recipients} />
          )}
        </span>

        {/* CENTER cell: speaker label for HUMAN/ORCH (centered like the body) */}
        <span
          style={{
            color: isHuman ? darken(myAccent) : styles.fg,
            fontWeight: 700,
            textAlign: 'center',
            whiteSpace: 'nowrap',
          }}
        >
          {(isHuman || isOrch) && <span>[{styles.label}] {line.speaker}</span>}
        </span>

        {/* RIGHT cell: tick number */}
        <span
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
            color: tokens.text.muted,
          }}
        >
          <span>T{line.tick}</span>
        </span>
      </div>
      <div
        style={{
          color: tokens.text.onParchment,
          fontStyle: isHuman ? 'italic' : 'normal',
          // HUMAN + ORCH bodies center; WHISPER stays left-aligned.
          textAlign: (isHuman || isOrch) ? 'center' : 'left',
        }}
      >
        {line.body}
      </div>
    </li>
  );
}

function WorldEventChip() {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: '2px 8px',
        borderRadius: '999px',
        fontSize: '8px',
        fontWeight: 700,
        letterSpacing: '0.10em',
        textTransform: 'lowercase',
        color: '#ffffff',
        background: lighten(WORLD_EVENT_CHIP_BG, 0.35),
        lineHeight: 1.4,
      }}
    >
      world event
    </span>
  );
}

function OwnerChip({ accent }: { accent: string }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: '2px 8px',
        borderRadius: '999px',
        fontSize: '8px',
        fontWeight: 700,
        letterSpacing: '0.10em',
        textTransform: 'lowercase',
        color: '#ffffff',
        background: lighten(accent, 0.35),
        lineHeight: 1.4,
      }}
    >
      steering msg
    </span>
  );
}

function SentToChips({ recipients }: { recipients: number[] }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '3px',
        textTransform: 'lowercase',
      }}
    >
      <span style={{ color: tokens.text.onParchmentDim, fontWeight: 600 }}>sent to:</span>
      {recipients.map((clanId) => (
        <span
          key={clanId}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            minWidth: '11px',
            height: '10px',
            padding: '0 3px',
            borderRadius: '999px',
            fontSize: '7px',
            fontWeight: 700,
            color: '#ffffff',
            background: lighten(CLAN_ACCENT[clanId] ?? '#5a8aa8', 0.35),
            lineHeight: 1,
          }}
        >
          {clanId}
        </span>
      ))}
    </span>
  );
}

function BulletinView({ elder, testIdPrefix }: Props) {
  // The bulletins table uses `slot` as a tick-equivalent ordinal, so we
  // map slot → tick for the existing fade/visibility logic.
  const live = useQuery(api.bulletins.getByClan, { clanId: elder.clanId });
  const currentTick = useCurrentWorldTick();
  const posts: BulletinPost[] = (live ?? []).map(b => ({
    tick: b.slot,
    speaker: `clan-${b.clanId}`,
    body: b.body,
  }));

  const accent = CLAN_ACCENT[elder.clanId] ?? '#5a8aa8';
  const visible = posts.filter(p => currentTick - p.tick <= VISIBLE_TICKS);
  const old = posts.filter(p => currentTick - p.tick > VISIBLE_TICKS);

  return (
    <div
      data-testid={`${testIdPrefix}-comms-bulletin-list`}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
      }}
    >
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '6px' }}>
        {visible.map((p, i) => (
          <BulletinPostRow key={`v-${i}`} post={p} accent={accent} elder={elder} index={i} currentTick={currentTick} />
        ))}
      </ul>

      {old.length > 0 && (
        <>
          <OldBulletinSeparator />
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {old.map((p, i) => (
              <BulletinPostRow key={`o-${i}`} post={p} accent={accent} elder={elder} index={i} currentTick={currentTick} />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

export function OldBulletinSeparator() {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        padding: '4px 0',
      }}
    >
      <span style={{ flex: 1, height: '1px', background: tokens.border.parchmentEdge }} />
      <span
        style={{
          fontFamily: tokens.font.mono,
          fontSize: '9px',
          letterSpacing: '0.18em',
          textTransform: 'uppercase',
          color: tokens.text.muted,
          whiteSpace: 'nowrap',
        }}
      >
        Old Bulletin Messages
      </span>
      <span style={{ flex: 1, height: '1px', background: tokens.border.parchmentEdge }} />
    </div>
  );
}

function BulletinPostRow({
  post, accent, elder, index, currentTick,
}: { post: BulletinPost; accent: string; elder: ElderDef; index: number; currentTick: number }) {
  const isVisible = currentTick - post.tick <= VISIBLE_TICKS;
  const opacity = fadeOpacity(post.tick, currentTick);
  return (
    <li
      data-testid={`bulletin-${elder.clanId}-${index}`}
      data-visible={isVisible}
      style={{
        background: hexToRgba(accent, 0.1),
        borderLeft: `3px solid ${accent}`,
        border: `1px solid ${tokens.border.parchmentEdge}`,
        borderLeftWidth: '3px',
        borderLeftColor: accent,
        padding: '7px 9px',
        fontSize: '11px',
        display: 'flex',
        flexDirection: 'column',
        gap: '3px',
        opacity,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          fontFamily: tokens.font.mono,
          fontSize: '9px',
          letterSpacing: '0.12em',
        }}
      >
        <span style={{ color: darken(accent), fontWeight: 700 }}>
          {elder.glyph} {ELDERS[elder.clanId - 1]?.name ?? `Elder ${elder.clanId}`}
        </span>
        {/* Right-side: visible chip + tick number */}
        <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <VisibilityChip visible={isVisible} />
          <span style={{ color: tokens.text.muted }}>T{post.tick}</span>
        </span>
      </div>
      <div style={{ color: tokens.text.onParchment }}>{post.body}</div>
    </li>
  );
}

export function VisibilityChip({ visible }: { visible: boolean }) {
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '1px 6px',
        borderRadius: '999px',
        fontSize: '8px',
        fontWeight: 700,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        background: visible ? 'rgba(106,168,136,0.18)' : 'rgba(120,108,84,0.18)',
        color: visible ? '#3a6a4a' : '#6b5e44',
        border: `1px solid ${visible ? '#6aa888' : tokens.border.parchmentEdge}`,
      }}
    >
      {visible ? 'visible' : 'old (hidden)'}
    </span>
  );
}
