import { useMemo, useRef, useEffect, useState } from 'react';
import {
  REGION_DEEP_SEA,
  REGION_EAST_DOCKS,
  REGION_EAST_FARMS,
  REGION_FOREST,
  REGION_MOUNTAINS,
  REGION_UNICORN_TOWN,
  REGION_WEST_DOCKS,
  REGION_WEST_FARMS,
} from '@clan-world/shared/generated/constants';
import { ActionType, BanditState } from '@clan-world/shared/generated/enums';
import { RESOURCE_NAMES_BY_ENUM } from '@clan-world/shared/utils/resources';
import { useSafeQuery as useQuery } from './hooks/useSafeQuery';
import { api } from '../../server/convex/_generated/api';
import type { Doc } from '../../server/convex/_generated/dataModel';
import { useAgentLogs } from './useAgentLogs';
import { ELDERS } from './styles/cockpit-tokens';

const DEMO_MODE = import.meta.env?.VITE_CLANWORLD_DEMO_MODE === 'true';

// --- Region + action label tables (mirrors WorldMap.tsx) ---

const REGION_NAMES: Record<number, string> = {
  [Number(REGION_FOREST)]: 'Forest',
  [Number(REGION_MOUNTAINS)]: 'Mountains',
  [Number(REGION_UNICORN_TOWN)]: 'Unicorn Town',
  [Number(REGION_WEST_FARMS)]: 'West Farms',
  [Number(REGION_EAST_FARMS)]: 'East Farms',
  [Number(REGION_WEST_DOCKS)]: 'West Docks',
  [Number(REGION_EAST_DOCKS)]: 'East Docks',
  [Number(REGION_DEEP_SEA)]: 'Deep Sea',
};

const ACTION_LABEL_BY_NAME: Record<string, string> = {
  ChopWood: 'chop wood',
  MineIron: 'mine iron',
  FishDocks: 'fish the docks',
  FishDeepSea: 'fish the deep sea',
  HarvestWheat: 'harvest wheat',
  DepositResources: 'deposit resources',
  UpgradeWall: 'upgrade wall',
  UpgradeBase: 'upgrade base',
  UpgradeMonument: 'upgrade monument',
  DefendBase: 'defend base',
  MarketBuy: 'buy at market',
  MarketSell: 'sell at market',
  Wait: 'wait',
  WithdrawResources: 'withdraw resources',
};

const ACTION_LABELS: Record<number, string> = Object.fromEntries(
  Object.entries(ActionType)
    .filter(([, value]) => typeof value === 'number' && value > 0)
    .map(([name, value]) => [value, ACTION_LABEL_BY_NAME[name] ?? name]),
);

// Clan color palette — matches heraldic colors in spec §1.2 + WorldMap.tsx MOCK_CLANS
const CLAN_COLORS: Record<string, string> = {
  'clan-iron':  '#4488cc',
  'clan-ember': '#cc4422',
  'clan-dawn':  '#ccaa22',
  'clan-storm': '#44aacc',
};

// Numeric clanId → hex color for live chain events
const CLAN_SLOT_COLORS = ['#b23a48', '#2c5f8d', '#d4a24c', '#3f704d', '#7b3f8c', '#a85a2c', '#e8d8b5', '#475569'];

function slotColor(clanId: number): string {
  return CLAN_SLOT_COLORS[(clanId - 1) % CLAN_SLOT_COLORS.length] ?? '#cccccc';
}

function clanDisplayName(clanId: number): string {
  return ELDERS.find((elder) => elder.clanId === clanId)?.name ?? String(clanId);
}

// ---- Chain event → ticker string -----------------------------------------------

type ChainEvent = Doc<'chainEvents'>;
export type ChainEventForTicker = Pick<ChainEvent, 'eventName' | 'args' | 'tick' | 'clanId' | 'clansmanId'>;

function safeNum(v: unknown, fallback = 0): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : fallback;
  if (typeof v === 'bigint') return Number(v);
  if (typeof v === 'string') {
    // `Number(v) || fallback` would treat the valid value 0 (e.g. resourceIn=0)
    // as falsy and return the fallback. Use isFinite + isNaN guards instead so
    // "0" round-trips correctly and only NaN/empty/non-numeric strings fall back.
    const parsed = Number(v);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}

function resourceAmount(v: unknown): string {
  const n = safeNum(v, 0);
  if (n <= 0) return '';
  const human = n >= 1e12 ? n / 1e18 : n;
  if (human >= 10) return String(Math.round(human));
  if (human >= 1) return human.toFixed(1).replace(/\\.0$/, '');
  return human.toFixed(2).replace(/0+$/, '').replace(/\\.$/, '');
}

export function formatChainEvent(ev: ChainEventForTicker): TickerEntry | null {
  const args = (ev.args ?? {}) as Record<string, unknown>;
  const clanId = ev.clanId ?? safeNum(args.clanId, 0);
  const clanLabel = clanId > 0 ? `Clan ${clanId}` : 'Unknown';
  const clanColor = clanId > 0 ? slotColor(clanId) : '#aaa';
  const tick = ev.tick ?? safeNum(args.tick ?? args.atTick ?? args.openedTick, 0);
  const regionId = safeNum(args.region, 0) || safeNum(args.toRegion, 0);
  const regionName = REGION_NAMES[regionId] ?? `Region ${regionId}`;

  switch (ev.eventName) {
    case 'MissionAssigned': {
      const action = safeNum(args.action, 0);
      const label = ACTION_LABELS[action] ?? 'act';
      const dest = safeNum(args.region, 0) || safeNum(args.targetRegion, 0);
      const destName = REGION_NAMES[dest] ?? regionName;
      return { text: `${clanLabel} clansman → ${destName} to ${label}`, clanColor };
    }
    case 'WorkerArrived':
      return { text: `${clanLabel} worker arrived at ${regionName}`, clanColor };
    case 'MissionCompleted': {
      const action = safeNum(args.action, 0);
      const label = ACTION_LABELS[action] ?? 'mission';
      return { text: `${clanLabel} completed: ${label}`, clanColor };
    }
    case 'ResourcesGathered': {
      const parts: string[] = [];
      ['wood', 'iron', 'wheat', 'fish'].forEach((r, i) => {
        const key = `${r}Gained`;
        const amt = resourceAmount(args[key] ?? args[r]);
        if (amt) parts.push(`${amt} ${RESOURCE_NAMES_BY_ENUM[i]}`);
      });
      if (!parts.length) return null;
      return { text: `${clanLabel} gathered ${parts.join(', ')}`, clanColor };
    }
    case 'ResourcesDeposited': {
      const parts: string[] = [];
      ['wood', 'iron', 'wheat', 'fish'].forEach((r, i) => {
        const title = r.charAt(0).toUpperCase() + r.slice(1);
        const raw = args[`${r}Delta`] ?? args[r] ?? args[`amount${title}`];
        const amt = resourceAmount(raw);
        if (amt) parts.push(`${amt} ${RESOURCE_NAMES_BY_ENUM[i]}`);
      });
      if (!parts.length) return { text: `${clanLabel} deposited resources`, clanColor };
      return { text: `${clanLabel} deposited ${parts.join(', ')}`, clanColor };
    }
    case 'ImmediateMarketActionExecuted':
    case 'ScheduledMarketActionExecuted': {
      const resourceIn = safeNum(args.resourceIn, -1);
      const resourceOut = safeNum(args.resourceOut, -1);
      const amtIn = safeNum(args.amountIn, 0);
      const amtOut = safeNum(args.amountOut, 0);
      if (resourceIn === -1 || resourceOut === -1) return null;
      const inName = RESOURCE_NAMES_BY_ENUM[resourceIn] ?? `res${resourceIn}`;
      const outName = RESOURCE_NAMES_BY_ENUM[resourceOut] ?? `res${resourceOut}`;
      return {
        text: `${clanLabel} traded ${amtIn} ${inName} → ${amtOut} ${outName} at Unicorn Town`,
        clanColor,
        highlight: true,
      };
    }
    case 'BanditSpawned': {
      const tier = safeNum(args.tier, 1);
      return { text: `⚠ Bandits spawned in ${regionName} — tier ${tier}`, clanColor: '#b23a48', highlight: true };
    }
    case 'BanditStateChanged': {
      const newState = safeNum(args.newState, 0);
      if (newState === BanditState.Attacking) {
        return { text: `⚔ Bandits attacking in ${regionName}!`, clanColor: '#b23a48', highlight: true };
      }
      return null;
    }
    case 'BanditAttackResolved': {
      const targetId = safeNum(args.targetClanId, clanId);
      const targetColor = targetId > 0 ? slotColor(targetId) : '#aaa';
      const defended = args.defended === true || safeNum(args.defended, 0) === 1;
      return {
        text: `⚔ Clan ${targetId} ${defended ? 'repelled the bandits!' : 'was raided by bandits!'}`,
        clanColor: defended ? '#3f704d' : '#b23a48',
        highlight: true,
        _targetColor: targetColor,
      };
    }
    case 'BanditDefeated':
      return { text: `★ Clan ${safeNum(args.targetClanId, clanId)} defeated the bandits!`, clanColor: '#d4a24c', highlight: true };
    case 'WallDamagedByBandit': {
      const newLevel = safeNum(args.newLevel, 0);
      return { text: `${clanLabel} wall damaged → level ${newLevel}`, clanColor: '#b23a48' };
    }
    case 'ClansmanKilledByBandit':
      return { text: `${clanLabel} lost a clansman to bandits`, clanColor: '#b23a48' };
    case 'ClansmanRevived': {
      const clansmanId = ev.clansmanId ?? safeNum(args.clansmanId, 0);
      return {
        text: `Clan ${clanDisplayName(clanId)} revived clansman #${clansmanId}`,
        clanColor,
        highlight: true,
      };
    }
    case 'WorldPaused':
      return { text: `World paused at tick ${tick}`, clanColor: '#d4a24c', highlight: true };
    case 'WorldUnpaused':
      return { text: `World unpaused at tick ${tick}`, clanColor: '#d4a24c', highlight: true };
    case 'BlueprintEarned':
      return { text: `${clanLabel} earned a blueprint!`, clanColor: '#d4a24c', highlight: true };
    case 'BuildingUpgraded': {
      const building = String(args.building ?? 'structure');
      const level = safeNum(args.newLevel, 0);
      return { text: `${clanLabel} upgraded ${building} → level ${level}`, clanColor, highlight: true };
    }
    case 'LootDistributed':
      return { text: `Loot distributed after bandit raid`, clanColor: '#d4a24c' };
    default:
      return null;
  }
}

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

// ---- Ticker entry type ---------------------------------------------------------

type TickerEntry = {
  text: string;
  clanColor: string;
  highlight?: boolean;
  _targetColor?: string;
};

// ---- Component -----------------------------------------------------------------

const SEPARATOR = '  •  ';
const SCROLL_PX_PER_SEC = 48;

export function EventTicker() {
  const agentLogs = useAgentLogs();
  const rawChainEvents = useQuery(api.events.getRecentChainEvents);

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
