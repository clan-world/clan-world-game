import { useMemo } from 'react';
import { useSafeQuery as useQuery } from '../../../hooks/useSafeQuery';
import { api } from '../../../../../server/convex/_generated/api';
import { tokens } from '../../../styles/cockpit-tokens';
import type { ElderDef } from '../../../styles/cockpit-tokens';

interface Props {
  elder: ElderDef;
  testIdPrefix: string;
}

interface ClansmanRow {
  id: string;
  mission: string;
  location: string;
  /** Ticks until mission completes — null = idle. */
  eta: number | null;
  /**
   * Absolute wall-clock time (unix seconds) the active mission settles, or null
   * when idle/dead or when the server can't derive it yet. When present we show
   * a human-readable local clock time ("ETA 3:42:10 AM"); otherwise we fall back
   * to the relative tick label ("ETA 2t"). Optional for back-compat with stub
   * data + older query payloads.
   */
  etaTs?: number | null;
  /** Ticks of cooldown remaining after mission ends — 0 = ready. */
  cooldown: number;
  /** Hunger fraction 0-1; >0.7 = visual starvation warning. */
  hunger: number;
  /**
   * True when the chain reports this clansman as ClansmanState.DEAD. The row
   * darkens, shows "DEAD" in place of mission, and suppresses the ETA/cooldown
   * countdown so a wiped clan doesn't look like it's about to act again.
   * Optional for back-compat with stub data + older query payloads.
   */
  isDead?: boolean;
}

// Stub fallback. Used whenever the live Convex query is still loading
// (`undefined`) OR returns an empty roster (cold demo / Convex offline).
// The cockpit must demo cleanly even with the backend unreachable.
//
// Settle times are seeded relative to "now" so the stub demo renders a
// realistic upcoming clock time ("ETA 3:42:10 AM") rather than a frozen epoch
// value. NOTE: "now" is computed at *call time* (inside the function below),
// NOT captured once at module load — a module-level `const NOW_SECONDS` freezes
// at first import, so by the time the cockpit actually mounts (or remounts on a
// later tab switch) the stub ETAs would already be in the past and the demo
// would render stale/elapsed clock times. Re-deriving per build keeps the stub
// rows perpetually fresh.
function buildStubClansmen(): ClansmanRow[] {
  const nowSeconds = Math.floor(Date.now() / 1000);
  return [
    { id: 'C1', mission: 'Chop Wood', location: 'Forest',     eta: 2, etaTs: nowSeconds + 60,  cooldown: 0, hunger: 0.4 },
    { id: 'C2', mission: 'Harvest Wheat', location: 'East Farms', eta: 1, etaTs: nowSeconds + 30,  cooldown: 0, hunger: 0.2 },
    { id: 'C3', mission: 'Idle',      location: 'Home',       eta: null, etaTs: null,             cooldown: 3, hunger: 0.78 },
    { id: 'C4', mission: 'Mine Iron', location: 'Mountains',  eta: 4, etaTs: nowSeconds + 120, cooldown: 0, hunger: 0.55 },
  ];
}

/**
 * Format an absolute settle timestamp (unix *seconds*) as a local clock time,
 * e.g. "3:42:10 AM". Liam's note (voice 2026-06-14): a live countdown risks
 * React timer/cleanup bugs, so we render a stable absolute time instead. The
 * value re-derives naturally on each Convex query push, so it stays fresh
 * without any client-side interval.
 */
function formatEtaClock(etaTs: number): string {
  const d = new Date(etaTs * 1000);
  // Guard against NaN/invalid etaTs — toLocaleTimeString() would otherwise
  // render the literal string "Invalid Date" in the ETA column.
  if (Number.isNaN(d.getTime())) return '??:??:??';
  return d.toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  });
}

/**
 * Decide what the ETA column should read for a live/stub row. Returns the
 * display string plus an optional hover `title` (for the absolute-clock case).
 *
 * Edge handling (super-swarm M3): an absolute clock time is only meaningful for
 * a settle that is still in the *future*. When the mission is due now (`eta` has
 * decayed to 0) or `etaTs` has already slipped into the past — e.g. the tab is
 * mid-render between a settle and the next Convex push — rendering a wall-clock
 * time like "ETA 3:42:10 AM" is misleading (it reads as upcoming when it's
 * already elapsed). In those cases we show "due" instead. We compute "now" at
 * call time so the past-check stays accurate across re-renders.
 */
function renderEta(eta: number, etaTs?: number | null): { text: string; title?: string } {
  if (etaTs == null) {
    // Server couldn't derive an absolute settle time (e.g. tick epoch not yet
    // surfaced) — fall back to the relative tick count. eta===0 still reads as
    // "ETA 0t" which the relative label conveys fine.
    return { text: `ETA ${eta}t` };
  }
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (eta <= 0 || etaTs <= nowSeconds) {
    // Due now / settle already in the past — a clock time would mislead.
    return { text: 'due', title: `Settled at ${formatEtaClock(etaTs)}` };
  }
  const clock = formatEtaClock(etaTs);
  return { text: `ETA ${clock}`, title: `Settles at ${clock} (${eta}t)` };
}

export function ClansmanTab({ elder, testIdPrefix }: Props) {
  // Stub-fallback pattern (mirrors VaultTab + CommsTab): live query drives the
  // roster when present; STUB_CLANSMEN renders if the query is still loading
  // (undefined) OR if the chain hasn't surfaced any clansmen yet (empty array).
  // `data-source` makes the choice observable for E2E + visual debugging.
  const live = useQuery(api.clansmen.getClanClansmen, { clanId: elder.clanId });
  const isLive = live !== undefined && live.length > 0;
  // Build the stub roster at render time (not module load) so its relative ETAs
  // are anchored to the moment the tab actually mounts. Memoized per mount so we
  // don't re-anchor (and visibly jump the clock) on every unrelated re-render.
  const stub = useMemo(buildStubClansmen, []);
  const rows: ClansmanRow[] = isLive ? live : stub;

  return (
    <div
      data-testid={`${testIdPrefix}-content-clansman`}
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
      <h3
        style={{
          margin: 0,
          fontFamily: tokens.font.display,
          fontSize: '11px',
          letterSpacing: '0.18em',
          textTransform: 'uppercase',
          color: tokens.text.onParchmentDim,
          borderBottom: `1px solid ${tokens.border.parchmentEdge}`,
          paddingBottom: '4px',
        }}
      >
        Clansmen — Clan {elder.clanId}
      </h3>

      <div
        data-testid={`${testIdPrefix}-clansman-list`}
        data-source={isLive ? 'live' : 'stub'}
        style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}
      >
        {rows.map((c) => {
          const starving = c.hunger > 0.7;
          // Dead state takes precedence over starvation styling: the whole row
          // dims so a wiped clan reads at-a-glance as fallen. Border switches
          // to the danger color (same red used for starvation) but the row
          // alpha drops to ~55%, giving the "tombstone" affordance.
          const isDead = c.isDead === true;
          const borderColor = isDead
            ? tokens.text.danger
            : starving
              ? tokens.text.danger
              : tokens.border.parchmentEdge;
          return (
            <div
              key={c.id}
              data-testid={`${testIdPrefix}-clansman-${c.id}`}
              data-dead={isDead ? 'true' : 'false'}
              style={{
                display: 'grid',
                // ETA column widened from 60px → 88px to fit a clock time like
                // "ETA 3:42:10 AM" without clipping (was sized for "ETA 2t").
                gridTemplateColumns: '28px 1fr 88px 36px',
                gap: tokens.space.sm,
                alignItems: 'center',
                padding: '6px 8px',
                background: isDead ? 'rgba(0,0,0,0.18)' : 'rgba(255,255,255,0.22)',
                border: `1px solid ${borderColor}`,
                borderRadius: tokens.radius.sm,
                fontFamily: tokens.font.mono,
                fontSize: '11px',
                opacity: isDead ? 0.55 : 1,
              }}
            >
              <span
                style={{
                  fontWeight: 700,
                  color: elder.accent,
                  fontSize: '12px',
                  textDecoration: isDead ? 'line-through' : 'none',
                }}
              >
                {c.id}
              </span>
              <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                <span
                  style={{
                    fontWeight: isDead ? 700 : 600,
                    color: isDead ? tokens.text.danger : tokens.text.onParchment,
                    letterSpacing: isDead ? '0.12em' : undefined,
                  }}
                >
                  {c.mission}
                </span>
                <span
                  style={{
                    color: tokens.text.onParchmentDim,
                    fontSize: '10px',
                  }}
                >
                  {c.location}
                </span>
              </div>
              <div
                style={{
                  fontSize: '10px',
                  color: tokens.text.onParchmentDim,
                  textAlign: 'right',
                  whiteSpace: 'nowrap',
                }}
              >
                {isDead ? (
                  // Dead clansmen have no mission to ETA and no cooldown to
                  // burn down — show an em dash so the column stays visually
                  // aligned but doesn't suggest impending action.
                  <span aria-label="dead — no countdown">—</span>
                ) : c.eta !== null ? (
                  // Prefer a human-readable local clock time ("ETA 3:42:10 AM")
                  // when the server could derive a *future* absolute settle
                  // time; render "due" when it's already elapsed; fall back to
                  // the relative tick count when the server couldn't derive an
                  // absolute time at all (e.g. tick epoch not yet surfaced). The
                  // action name itself is the row's primary label above.
                  (() => {
                    const { text, title } = renderEta(c.eta, c.etaTs);
                    return <span title={title}>{text}</span>;
                  })()
                ) : c.cooldown > 0 ? (
                  <span>CD {c.cooldown}t</span>
                ) : (
                  <span style={{ color: '#3a7a3a' }}>ready</span>
                )}
              </div>
              <HungerBar hunger={c.hunger} starving={starving && !isDead} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function HungerBar({ hunger, starving }: { hunger: number; starving: boolean }) {
  const pct = Math.round(hunger * 100);
  const fill = starving ? tokens.text.danger : '#b8862e';
  return (
    <div
      title={`Hunger ${pct}%`}
      style={{
        position: 'relative',
        height: '8px',
        background: 'rgba(0,0,0,0.18)',
        borderRadius: '1px',
        overflow: 'hidden',
        border: `1px solid ${tokens.border.parchmentEdge}`,
      }}
    >
      <div
        style={{
          position: 'absolute',
          inset: 0,
          width: `${pct}%`,
          background: fill,
          transition: 'width 240ms ease',
        }}
      />
    </div>
  );
}
