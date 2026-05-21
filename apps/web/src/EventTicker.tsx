import { useMemo, useRef, useEffect, useState } from 'react';
import { useSafeQuery as useQuery } from './hooks/useSafeQuery';
import { api } from '../../server/convex/_generated/api';
import { useAgentLogs } from './useAgentLogs';
import {
  formatChainEvent,
  type ChainEventForTicker,
  type TickerEntry,
} from './eventTickerFormat';

// Re-export so existing callers / tests that imported from EventTicker still resolve.
export { formatChainEvent };
export type { ChainEventForTicker, TickerEntry };

const DEMO_MODE = import.meta.env?.VITE_CLANWORLD_DEMO_MODE === 'true';

// Clan color palette — matches heraldic colors in spec §1.2 + WorldMap.tsx MOCK_CLANS
const CLAN_COLORS: Record<string, string> = {
  'clan-iron':  '#4488cc',
  'clan-ember': '#cc4422',
  'clan-dawn':  '#ccaa22',
  'clan-storm': '#44aacc',
};

// ---- Agent log → ticker string (DEMO_MODE fallback) ----------------------------

// Clan name patterns used by the Elders in DEMO_MODE logs
const MOCK_CLAN_PATTERNS: { pattern: RegExp; name: string; color: string }[] = [
  { pattern: /iron\s*guard/i,   name: 'Iron Guard',   color: CLAN_COLORS['clan-iron']  ?? '#4488cc' },
  { pattern: /ember\s*hand/i,   name: 'Ember Hand',   color: CLAN_COLORS['clan-ember'] ?? '#cc4422' },
  { pattern: /dawn\s*watch/i,   name: 'Dawn Watch',   color: CLAN_COLORS['clan-dawn']  ?? '#ccaa22' },
  { pattern: /storm\s*riders/i, name: 'Storm Riders', color: CLAN_COLORS['clan-storm'] ?? '#44aacc' },
];

const DEMO_REGION_PATTERNS = [
  'Forest', 'Mountains', 'Unicorn Town', 'West Farms', 'East Farms',
  'West Docks', 'East Docks', 'Deep Sea',
];

function matchRegionInText(text: string): string | null {
  // Longest match first to avoid "Farms" matching before "West Farms"
  const sorted = [...DEMO_REGION_PATTERNS].sort((a, b) => b.length - a.length);
  for (const r of sorted) {
    if (text.toLowerCase().includes(r.toLowerCase())) return r;
  }
  return null;
}

function formatAgentLog(msg: string): TickerEntry | null {
  // Skip purely internal/debug lines
  if (msg.startsWith('[') || msg.startsWith('DEBUG') || msg.length < 10) return null;

  // Strip "warn|" / "info|" prefix
  const cleaned = msg.replace(/^(warn|info|error)\|\s*/i, '').trim();

  // WORLD-level events — already shown in WorldNoticePanel, but worth in ticker too
  const isWorld = cleaned.toLowerCase().startsWith('world:') ||
    /\b(bandit|raid|winter|omen)\b/i.test(cleaned);
  if (isWorld) {
    const text = cleaned.replace(/^WORLD:\s*/i, '').trim();
    return { text: `⚠ ${text}`, clanColor: '#b23a48', highlight: true };
  }

  // Identify clan
  let clanName: string | null = null;
  let clanColor = '#cccccc';
  for (const p of MOCK_CLAN_PATTERNS) {
    if (p.pattern.test(cleaned)) {
      clanName = p.name;
      clanColor = p.color;
      break;
    }
  }

  // Strip "Clan Elder:" prefix
  const body = cleaned.replace(/^[^:]+Elder:\s*/i, '').trim();
  if (!body) return null;

  // Travel dispatch
  const travelMatch = body.match(
    /\b(?:send(?:ing)?|dispatch(?:ing|ed)?|travel(?:ing)?|head(?:ing)?)\b.*?\bto\b\s+(?:the\s+)?([A-Z][a-z ]+)/i,
  );
  if (travelMatch) {
    const dest = matchRegionInText(travelMatch[1] ?? '') ?? travelMatch[1] ?? '';
    const prefix = clanName ?? 'A clansman';
    return { text: `${prefix} → ${dest}`, clanColor };
  }

  // Deposit
  if (/\bdeposit\b/i.test(body)) {
    const prefix = clanName ?? 'Clan';
    return { text: `${prefix} depositing resources at base`, clanColor };
  }

  // Trade
  if (/\b(market|trade|unicorn town|sell|buy)\b/i.test(body)) {
    const prefix = clanName ?? 'Clan';
    return { text: `${prefix} trading at Unicorn Town`, clanColor, highlight: true };
  }

  // Upgrade
  const upgradeMatch = body.match(/\bupgrad(?:ing|e)\b[^.]*?(wall|base|monument)/i);
  if (upgradeMatch) {
    const prefix = clanName ?? 'Clan';
    return { text: `${prefix} upgrading ${upgradeMatch[1]}`, clanColor, highlight: true };
  }

  return null;
}

// ---- Component -----------------------------------------------------------------

const SEPARATOR = '  •  ';
const SCROLL_PX_PER_SEC = 48;

export function EventTicker() {
  const agentLogs = useAgentLogs();
  // Capped to 10 events (issue #336). The pre-split version pulled the last
  // 60 events on every chainEvents insert (~36 KB × N-clients). 10 keeps the
  // ticker visually full while cutting per-tick egress ~6×.
  const rawChainEvents = useQuery(api.events.getEventTickerFeed, { limit: 10 });

  const entries = useMemo<TickerEntry[]>(() => {
    if (!DEMO_MODE && rawChainEvents && rawChainEvents.length > 0) {
      // Live mode: format chain events, most recent first, skip nulls
      return rawChainEvents
        .slice()
        // Sort ascending (oldest first) so the ticker reads chronologically left→right
        .sort((a, b) => a.blockNumber - b.blockNumber || a.logIndex - b.logIndex)
        .map(formatChainEvent)
        .filter((e): e is TickerEntry => e !== null);
    }

    // DEMO_MODE or no chain events yet: parse agent logs
    return [...agentLogs]
      .reverse() // oldest first
      .map(l => formatAgentLog(l.message))
      .filter((e): e is TickerEntry => e !== null);
  }, [rawChainEvents, agentLogs]);

  // Compose a single long string for CSS animation
  const tickerText = useMemo(() => {
    if (entries.length === 0) return null;
    // We'll render as spans so we keep per-entry coloring
    return entries;
  }, [entries]);

  // Measure rendered width so we can set the correct animation duration
  const innerRef = useRef<HTMLDivElement>(null);
  const [animDuration, setAnimDuration] = useState(30);

  useEffect(() => {
    if (!innerRef.current) return;
    const w = innerRef.current.scrollWidth;
    setAnimDuration(Math.max(15, w / SCROLL_PX_PER_SEC));
  }, [tickerText]);

  if (!tickerText || tickerText.length === 0) return null;

  return (
    <div
      style={{
        position: 'absolute',
        bottom: 8,
        left: 0,
        right: 0,
        height: 24,
        background: 'rgba(10, 16, 10, 0.78)',
        borderTop: '1px solid rgba(204, 170, 34, 0.25)',
        borderBottom: '1px solid rgba(204, 170, 34, 0.12)',
        overflow: 'hidden',
        display: 'flex',
        alignItems: 'center',
        pointerEvents: 'none',
        zIndex: 4,
      }}
    >
      <style>{`
        @keyframes cw-ticker-scroll {
          0%   { transform: translateX(100vw); }
          100% { transform: translateX(-100%); }
        }
      `}</style>
      <div
        ref={innerRef}
        style={{
          display: 'flex',
          alignItems: 'center',
          whiteSpace: 'nowrap',
          animation: `cw-ticker-scroll ${animDuration}s linear infinite`,
          willChange: 'transform',
        }}
      >
        {tickerText.map((entry, i) => (
          <span key={i} style={{ display: 'inline-flex', alignItems: 'center' }}>
            <span
              style={{
                color: entry.clanColor,
                fontFamily: '"VT323", "Courier New", monospace',
                fontSize: 14,
                letterSpacing: '0.03em',
                fontWeight: entry.highlight ? 700 : 400,
                textShadow: entry.highlight
                  ? `0 0 8px ${entry.clanColor}88`
                  : undefined,
              }}
            >
              {entry.text}
            </span>
            {i < tickerText.length - 1 && (
              <span
                style={{
                  color: 'rgba(204, 170, 34, 0.55)',
                  fontFamily: '"VT323", "Courier New", monospace',
                  fontSize: 14,
                  padding: '0 4px',
                }}
              >
                {SEPARATOR}
              </span>
            )}
          </span>
        ))}
      </div>
    </div>
  );
}
