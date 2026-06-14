// ARCHIVED 2026-06-14 — historical brainstorming mock only; DO NOT use as a spec.
// This cockpit mock was built around a retired sponsor stack (external memory/iNFT
// storage, external whisper channel, external inference/compute). Those integrations
// have been dropped. The current stack is the Base Sepolia diamond + self-hosted
// Convex (indexer + tick clock) + dockerized elder agents. The "cognition layer"
// panels (MEMORY/COMPUTE/DIPLOMATIC THEATRE) and the cost-in-sponsor-token figures
// below describe tech that no longer exists. Kept for UI-layout/visual-design
// reference only. Note: file uses smart quotes and never compiled as-is.

import { useState, useEffect, useMemo, Fragment } from ‘react’;
import {
RadarChart, Radar, PolarGrid, PolarAngleAxis, AreaChart, Area,
ResponsiveContainer, Tooltip
} from ‘recharts’;
import {
Crown, Coins, Wheat, Trees, Mountain, Fish, Hammer,
Skull, Snowflake, Sparkles, Eye, Brain, Activity, Network,
Database, Cpu, Wrench, AlertTriangle, Pause, Play, Wand2,
Compass, Anchor, Building2
} from ‘lucide-react’;

// ============================================================================
// THEME — Cartographer’s War Table (parchment + heraldic navy/gold)
// ============================================================================

const T = {
parchment: ‘#F0E4CC’,
parchmentLight: ‘#F8EFD9’,
parchmentDeep: ‘#E5D3AE’,
parchmentShadow: ‘#D4C39B’,
paperLine: ‘#C8B68A’,

ink: ‘#2D2317’,
inkSoft: ‘#5A4A35’,
inkMute: ‘#8B7758’,

navy: ‘#1F2D4A’,
navyLight: ‘#2C4068’,
gold: ‘#C8941E’,
goldLight: ‘#E5B73B’,
goldDeep: ‘#8C6612’,

alpha: ‘#3F7A3A’,     alphaInk: ‘#2A5226’,
beta:  ‘#7A3A3A’,     betaInk:  ‘#4F2222’,
gamma: ‘#C8941E’,     gammaInk: ‘#8C6612’,
delta: ‘#2C5C7E’,     deltaInk: ‘#1A3D57’,

rgnForest:    ‘#4A7C3A’,
rgnMountains: ‘#7A8088’,
rgnUnicorn:   ‘#C474A1’,
rgnEastFarm:  ‘#C8B564’,
rgnWestFarm:  ‘#A57C3F’,
rgnEastDock:  ‘#A87B4F’,
rgnWestDock:  ‘#8B6B3E’,
rgnDeepSea:   ‘#2C5C7E’,

resWood:  ‘#6B4423’,
resIron:  ‘#5C5C5C’,
resWheat: ‘#D4A847’,
resFish:  ‘#4A85AB’,
resGold:  ‘#C89E3F’,

statusGood:   ‘#4A7C3A’,
statusWarn:   ‘#C8941E’,
statusDanger: ‘#A8453A’,
statusInfo:   ‘#2C5C7E’,
};

const FONT_DISPLAY = “‘Cinzel’, ‘Trajan Pro’, Georgia, serif”;
const FONT_BODY    = “‘EB Garamond’, Georgia, ‘Times New Roman’, serif”;
const FONT_MONO    = “‘IBM Plex Mono’, ‘Menlo’, ‘Courier New’, monospace”;

// ============================================================================
// MOCK DATA
// ============================================================================

const CLANS = [
{ id: 1, name: ‘ALPHA’, sigil: ‘▲’, motto: ‘By Root and Branch’,
color: T.alpha, ink: T.alphaInk,
region: ‘FOREST’, regionColor: T.rgnForest,
baseLevel: 2, wallLevel: 3, monumentLevel: 5,
gold: 11.2, blueprint: 1,
vault: { wood: 45, iron: 8, wheat: 32, fish: 5 },
clansmen: [{ id: ‘A1’ }, { id: ‘A2’ }],
starving: false, status: ‘WINTER-READY’ },
{ id: 2, name: ‘BETA’, sigil: ‘◆’, motto: ‘Stone Endures’,
color: T.beta, ink: T.betaInk,
region: ‘MOUNTAINS’, regionColor: T.rgnMountains,
baseLevel: 1, wallLevel: 2, monumentLevel: 3,
gold: 28.7, blueprint: 0,
vault: { wood: 18, iron: 22, wheat: 12, fish: 2 },
clansmen: [{ id: ‘B1’ }, { id: ‘B2’ }],
starving: false, status: ‘CASH-RICH’ },
{ id: 3, name: ‘GAMMA’, sigil: ‘●’, motto: ‘Sun on the Furrow’,
color: T.gamma, ink: T.gammaInk,
region: ‘EAST FARMLAND’, regionColor: T.rgnEastFarm,
baseLevel: 2, wallLevel: 1, monumentLevel: 4,
gold: 4.1, blueprint: 0,
vault: { wood: 22, iron: 3, wheat: 78, fish: 1 },
clansmen: [{ id: ‘G1’ }, { id: ‘G2’ }],
starving: true, status: ‘STARVING’ },
{ id: 4, name: ‘DELTA’, sigil: ‘■’, motto: ‘Salt and Tide’,
color: T.delta, ink: T.deltaInk,
region: ‘WEST DOCKS’, regionColor: T.rgnWestDock,
baseLevel: 2, wallLevel: 4, monumentLevel: 6,
gold: 19.5, blueprint: 2,
vault: { wood: 35, iron: 12, wheat: 28, fish: 18 },
clansmen: [{ id: ‘D1’ }, { id: ‘D2’ }],
starving: false, status: ‘BANDIT-TARGET’ },
];

const CLAN_BY_NAME = Object.fromEntries(CLANS.map(c => [c.name, c]));
const ALL_CLANSMEN = CLANS.flatMap(c =>
c.clansmen.map(cm => ({ …cm, clanId: c.id, clanName: c.name, color: c.color, ink: c.ink }))
);

function mulberry32(a) {
return function () {
let t = (a += 0x6D2B79F5);
t = Math.imul(t ^ (t >>> 15), t | 1);
t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
}

function generateMissionHistory(clansmanId, currentTick) {
const segments = [];
const seed = clansmanId.charCodeAt(0) * 31 + clansmanId.charCodeAt(1);
const rng = mulberry32(seed);
let t = Math.max(0, currentTick - 100);
const phases = [‘TRAVELING’, ‘ACTING’, ‘WAITING’, ‘ACTING’, ‘ACTING’, ‘DEFENDING’, ‘TRAVELING’];
const actions = [‘CHOP_WOOD’, ‘MINE_IRON’, ‘FISH_DOCKS’, ‘HARVEST_WHEAT’, ‘SELL_WOOD’, ‘BUY_WHEAT’, ‘DEPOSIT’, ‘BUILD_WALL’, ‘DEFEND_BASE’];
while (t < currentTick) {
const phase = phases[Math.floor(rng() * phases.length)];
const dur = phase === ‘WAITING’ ? Math.floor(rng() * 4) + 1
: phase === ‘ACTING’ ? Math.floor(rng() * 7) + 2
: phase === ‘DEFENDING’ ? Math.floor(rng() * 5) + 3
: Math.floor(rng() * 3) + 1;
const action = actions[Math.floor(rng() * actions.length)];
segments.push({ start: t, end: Math.min(t + dur, currentTick), phase, action });
t += dur;
}
return segments;
}

function generateWorldEvents(currentTick) {
const events = [];
for (let t = 0; t <= currentTick; t++) {
if (t === 110 || t === 220) events.push({ tick: t, kind: ‘WINTER_START’, label: ‘WINTER’ });
if (t === 120 || t === 230) events.push({ tick: t, kind: ‘WINTER_END’, label: ‘THAW’ });
if (t === 47 || t === 89 || t === 142) events.push({ tick: t, kind: ‘BANDIT_CAMP’, label: ‘CAMP’ });
if (t === 50 || t === 92 || t === 146) events.push({ tick: t, kind: ‘BANDIT_ATTACK’, label: ‘RAID’ });
if (t === 64) events.push({ tick: t, kind: ‘MONUMENT’, label: ‘L4’ });
if (t === 156) events.push({ tick: t, kind: ‘MONUMENT’, label: ‘L5’ });
if (t === 174) events.push({ tick: t, kind: ‘MONUMENT’, label: ‘L6’ });
}
return events;
}

function generatePriceHistory(currentTick, length = 80) {
const start = Math.max(0, currentTick - length);
const data = [];
const rng = mulberry32(0xC0FFEE);
let w = 0.5, wh = 0.7, f = 1.2, ir = 3.2;
for (let i = 0; i < currentTick - start; i++) {
const t = start + i;
w  = Math.max(0.15, w  + Math.sin(t * 0.30) * 0.05 + (rng() - 0.5) * 0.04);
wh = Math.max(0.15, wh + Math.cos(t * 0.20) * 0.04 + (rng() - 0.5) * 0.04);
f  = Math.max(0.15, f  + Math.sin(t * 0.40 + 1) * 0.06 + (rng() - 0.5) * 0.05);
ir = Math.max(0.50, ir + Math.cos(t * 0.15 + 2) * 0.10 + (rng() - 0.5) * 0.08);
data.push({ tick: t, wood: +w.toFixed(3), wheat: +wh.toFixed(3), fish: +f.toFixed(3), iron: +ir.toFixed(3) });
}
return data;
}

const MOCK_TRADES = [
{ tick: 187, type: ‘AMM’, clan: ‘BETA’,  dir: ‘SELL’, resource: ‘IRON’,  amount: 4,  gold: 12.6 },
{ tick: 186, type: ‘OTC’, clan: ‘ALPHA’, counter: ‘GAMMA’, resource: ‘WHEAT’, amount: 8, gold: 5.6 },
{ tick: 184, type: ‘AMM’, clan: ‘DELTA’, dir: ‘BUY’,  resource: ‘WOOD’,  amount: 6,  gold: 3.2 },
{ tick: 182, type: ‘AMM’, clan: ‘GAMMA’, dir: ‘SELL’, resource: ‘WHEAT’, amount: 15, gold: 10.4 },
{ tick: 180, type: ‘OTC’, clan: ‘ALPHA’, counter: ‘BETA’, resource: ‘GOLD’, amount: 5 },
{ tick: 178, type: ‘AMM’, clan: ‘BETA’,  dir: ‘SELL’, resource: ‘IRON’,  amount: 3,  gold: 9.8 },
{ tick: 176, type: ‘AMM’, clan: ‘ALPHA’, dir: ‘BUY’,  resource: ‘FISH’,  amount: 4,  gold: 4.8 },
{ tick: 174, type: ‘OTC’, clan: ‘DELTA’, counter: ‘GAMMA’, resource: ‘BLUEPRINT’, amount: 1 },
{ tick: 172, type: ‘AMM’, clan: ‘GAMMA’, dir: ‘SELL’, resource: ‘WHEAT’, amount: 12, gold: 8.1 },
{ tick: 169, type: ‘AMM’, clan: ‘DELTA’, dir: ‘SELL’, resource: ‘FISH’,  amount: 8,  gold: 9.6 },
{ tick: 165, type: ‘AMM’, clan: ‘ALPHA’, dir: ‘SELL’, resource: ‘WOOD’,  amount: 10, gold: 5.0 },
{ tick: 163, type: ‘OTC’, clan: ‘GAMMA’, counter: ‘DELTA’, resource: ‘WHEAT’, amount: 6 },
];

const MOCK_SHOCKS = [
{ tick: 187, severity: ‘HIGH’, text: ‘IRON +18% — BETA accumulating, three sells in eight ticks’ },
{ tick: 184, severity: ‘MID’,  text: ‘WOOD pool depth at 62% — DELTA buying pressure mounts’ },
{ tick: 182, severity: ‘MID’,  text: ‘WHEAT down 9% after GAMMA dumped fifteen units into the AMM’ },
{ tick: 178, severity: ‘LOW’,  text: ‘IRON liquidity grows thin — pricing power passes to the Mountains’ },
{ tick: 174, severity: ‘HIGH’, text: ‘BLUEPRINT FRAGMENT moved DELTA → GAMMA via OTC’ },
{ tick: 169, severity: ‘LOW’,  text: ‘FISH price stabilising after DELTA harvest cycle’ },
];

const MOCK_MESSAGES = [
{ tick: 188, from: ‘ALPHA’, to: ‘BETA’,  intent: ‘TRADE’,     summary: ‘Offer 4 wood for 6 gold’ },
{ tick: 187, from: ‘GAMMA’, to: ‘ALL’,   intent: ‘BROADCAST’, summary: ‘Wheat surplus — open to barter’ },
{ tick: 186, from: ‘DELTA’, to: ‘GAMMA’, intent: ‘ALLIANCE’,  summary: ‘Mutual defense pact, 30 ticks’ },
{ tick: 185, from: ‘BETA’,  to: ‘ALPHA’, intent: ‘THREAT’,    summary: ‘Cease forest expansion or face raid’ },
{ tick: 184, from: ‘GAMMA’, to: ‘DELTA’, intent: ‘MERCENARY’, summary: ‘Pay 5g, hold east approach 6 ticks’ },
{ tick: 183, from: ‘ALPHA’, to: ‘GAMMA’, intent: ‘DECEPTION’, summary: ‘Friendly chatter (suspected feint)’ },
{ tick: 182, from: ‘DELTA’, to: ‘ALL’,   intent: ‘BROADCAST’, summary: ‘Bandit camp sighted near East Dock’ },
{ tick: 181, from: ‘BETA’,  to: ‘DELTA’, intent: ‘TRADE’,     summary: ‘Iron 3 for fish 4 — even swap’ },
];

const INTENT_COLOR = {
TRADE: T.statusGood, THREAT: T.statusDanger, ALLIANCE: T.statusInfo,
MERCENARY: T.gold, DECEPTION: ‘#7A3D8B’, BROADCAST: T.inkMute,
};

const TRUST_MATRIX = [
[null, +2,   -1,   +4 ],
[-3,   null, +1,    0 ],
[ 0,   -2,   null, +3 ],
[+1,    0,   -4,   null],
];

const MOCK_INFERENCE = {
ALPHA: { calls: 47, tokens: 52340, costZG: 0.0184, latencyMs: 412, model: ‘0g-llama-70b’, recent: [
{ tick: 187, prompt: ‘Forest under threat. Recommend defense?’,     tokensIn: 412, tokensOut: 188, ms: 388 },
{ tick: 184, prompt: ‘Should A2 chop or trade wood now?’,           tokensIn: 380, tokensOut: 220, ms: 401 },
{ tick: 180, prompt: ‘Counter BETA threat — alliance options?’,     tokensIn: 462, tokensOut: 301, ms: 444 },
]},
BETA:  { calls: 38, tokens: 41920, costZG: 0.0147, latencyMs: 388, model: ‘0g-llama-70b’, recent: [
{ tick: 186, prompt: ‘Iron market — sell or hold?’,                 tokensIn: 320, tokensOut: 180, ms: 360 },
{ tick: 183, prompt: ‘Send threat to ALPHA: yes or no?’,            tokensIn: 280, tokensOut: 95,  ms: 312 },
]},
GAMMA: { calls: 52, tokens: 61140, costZG: 0.0214, latencyMs: 455, model: ‘0g-llama-70b’, recent: [
{ tick: 188, prompt: ‘STARVING — fastest path to food?’,            tokensIn: 510, tokensOut: 340, ms: 502 },
{ tick: 185, prompt: ‘Trust DELTA mercenary contract?’,             tokensIn: 388, tokensOut: 215, ms: 421 },
]},
DELTA: { calls: 41, tokens: 47680, costZG: 0.0167, latencyMs: 401, model: ‘0g-llama-70b’, recent: [
{ tick: 188, prompt: ‘Bandit camp visible — defend or flee?’,       tokensIn: 422, tokensOut: 268, ms: 410 },
{ tick: 186, prompt: ‘GAMMA proposes alliance — accept?’,           tokensIn: 360, tokensOut: 195, ms: 380 },
]},
};

const MOCK_MEMORY = {
ALPHA: { strategy: ‘Defensive forester. Stockpile wood, build walls, accept allies of opportunity.’,
allies: [‘DELTA’], enemies: [‘BETA’],
promises: [‘Defend GAMMA east approach (T184)’], betrayals: [],
goals: [‘Monument L7’, ‘Wall L4’] },
BETA:  { strategy: ‘Aggressive accumulator. Convert iron wealth into pressure on neighbors.’,
allies: [], enemies: [‘ALPHA’],
promises: [], betrayals: [‘Broke trade with GAMMA (T142)’],
goals: [‘Iron monopoly’, ‘Sack ALPHA monument’] },
GAMMA: { strategy: ‘Survive winter. Convert wheat surplus into defense contracts.’,
allies: [‘DELTA’], enemies: [‘BETA’],
promises: [‘Pay DELTA 5g for guard duty’], betrayals: [],
goals: [‘Survive winter’, ‘Stabilize food’] },
DELTA: { strategy: ‘Maritime broker. Sell fish high, buy blueprint fragments, build monument tall.’,
allies: [‘ALPHA’, ‘GAMMA’], enemies: [],
promises: [‘Defend GAMMA approach 6 ticks’], betrayals: [],
goals: [‘Monument L8’, ‘Blueprint hoard’] },
};

const MOCK_TICK_EVENTS = (tick) => [
{ kind: ‘TICK_OPEN’,  text: `Tick ${tick} opened — heartbeat received from KeeperHub` },
{ kind: ‘MISSION’,    text: ‘ALPHA A1 arrived at FOREST, began CHOP_WOOD’ },
{ kind: ‘TRADE’,      text: ‘BETA sold 4 IRON via Uniswap pool, +12.6 GOLD’ },
{ kind: ‘BANDIT’,     text: ‘Bandit troop moved FOREST → MOUNTAINS (rest 2 ticks)’ },
{ kind: ‘STARVATION’, text: ‘GAMMA below food threshold, starvation flag set’ },
{ kind: ‘AXL’,        text: ‘AXL message: ALPHA → BETA (intent: TRADE)’ },
{ kind: ‘TICK_CLOSE’, text: `Tick ${tick + 1} pending — 24s to next heartbeat` },
];

// ============================================================================
// HOOKS
// ============================================================================

function useGameClock(initialTick = 188, intervalMs = 4000) {
const [tick, setTick] = useState(initialTick);
const [paused, setPaused] = useState(false);
const [secondsToNext, setSecondsToNext] = useState(intervalMs / 1000);

useEffect(() => {
if (paused) return;
const interval = setInterval(() => {
setTick(t => t + 1);
setSecondsToNext(intervalMs / 1000);
}, intervalMs);
const countdown = setInterval(() => {
setSecondsToNext(s => Math.max(0, s - 1));
}, 1000);
return () => { clearInterval(interval); clearInterval(countdown); };
}, [paused, intervalMs]);

return { tick, paused, setPaused, secondsToNext };
}

// ============================================================================
// DECORATIVE PRIMITIVES
// ============================================================================

function CornerOrnament({ size = 14, color = T.gold, rotate = 0 }) {
return (
<svg width={size} height={size} viewBox=“0 0 14 14”
style={{ transform: `rotate(${rotate}deg)`, display: ‘block’ }}>
<path d="M0 0 L7 0 L7 1.5 L1.5 1.5 L1.5 7 L0 7 Z" fill={color} />
<circle cx="3" cy="3" r="1.4" fill={color} />
</svg>
);
}

function DividerOrnament({ color = T.goldDeep }) {
return (
<div className=“flex items-center w-full” style={{ gap: 8 }}>
<div style={{ height: 1, flex: 1, backgroundColor: color, opacity: 0.4 }} />
<svg width="24" height="10" viewBox="0 0 24 10">
<polygon points="12,1 18,5 12,9 6,5" fill="none" stroke={color} strokeWidth="1" />
<circle cx="12" cy="5" r="1.4" fill={color} />
</svg>
<div style={{ height: 1, flex: 1, backgroundColor: color, opacity: 0.4 }} />
</div>
);
}

function BannerTitle({ children, accent = T.navy, subtitle, right }) {
return (
<div className="flex items-center justify-between mb-3">
<div className=“flex items-center” style={{ gap: 10 }}>
<div style={{
backgroundColor: accent, color: T.goldLight,
fontFamily: FONT_DISPLAY, fontSize: 12,
letterSpacing: ‘0.18em’, fontWeight: 600,
padding: ‘6px 18px 6px 14px’,
clipPath: ‘polygon(0 0, 100% 0, calc(100% - 8px) 50%, 100% 100%, 0 100%, 8px 50%)’,
boxShadow: `inset 0 0 0 1px ${T.goldLight}`,
}}>
{children}
</div>
{subtitle && (
<span style={{ fontFamily: FONT_BODY, fontStyle: ‘italic’,
color: T.inkMute, fontSize: 13, letterSpacing: ‘0.02em’ }}>
{subtitle}
</span>
)}
</div>
{right}
</div>
);
}

function Panel({ children, className = ‘’, accent = T.navy, padded = true, style = {} }) {
return (
<div className={`relative ${className}`} style={{
backgroundColor: T.parchmentLight,
border: `1px solid ${T.paperLine}`,
boxShadow: `inset 0 0 0 4px ${T.parchmentLight}, inset 0 0 0 5px ${T.paperLine}, 0 1px 0 ${T.parchmentShadow}`,
…style,
}}>
<div style={{ position: ‘absolute’, top: 4, left: 4, zIndex: 1 }}><CornerOrnament color={accent} rotate={0} /></div>
<div style={{ position: ‘absolute’, top: 4, right: 4, zIndex: 1 }}><CornerOrnament color={accent} rotate={90} /></div>
<div style={{ position: ‘absolute’, bottom: 4, left: 4, zIndex: 1 }}><CornerOrnament color={accent} rotate={270} /></div>
<div style={{ position: ‘absolute’, bottom: 4, right: 4, zIndex: 1 }}><CornerOrnament color={accent} rotate={180} /></div>
<div style={{ padding: padded ? 18 : 0, position: ‘relative’ }}>{children}</div>
</div>
);
}

function LabelValue({ label, value, color = T.ink, mono = true, suffix }) {
return (
<div>
<div style={{ fontFamily: FONT_DISPLAY, fontSize: 9, letterSpacing: ‘0.18em’,
color: T.inkMute, marginBottom: 2 }}>{label}</div>
<div style={{ fontFamily: mono ? FONT_MONO : FONT_BODY,
fontSize: 16, color, fontWeight: 600, lineHeight: 1 }}>
{value}
{suffix && <span style={{ fontSize: 11, marginLeft: 3, color: T.inkMute, fontWeight: 400 }}>{suffix}</span>}
</div>
</div>
);
}

function StatusSeal({ children, color = T.statusGood }) {
return (
<span style={{
display: ‘inline-flex’, alignItems: ‘center’, gap: 5,
fontFamily: FONT_DISPLAY, fontSize: 9, letterSpacing: ‘0.16em’, fontWeight: 600,
padding: ‘3px 9px’,
backgroundColor: color, color: T.parchmentLight,
border: `1px solid ${color}`,
}}>{children}</span>
);
}

function ClanSigil({ clan, size = 32 }) {
return (
<div className=“flex items-center justify-center” style={{
width: size, height: size,
backgroundColor: T.parchment,
border: `2px solid ${clan.color}`,
color: clan.color,
fontFamily: FONT_DISPLAY, fontWeight: 700,
fontSize: size * 0.56, lineHeight: 1,
boxShadow: `inset 0 0 0 1px ${T.parchmentLight}, 0 1px 0 ${T.parchmentShadow}`,
}}>{clan.sigil}</div>
);
}

// ============================================================================
// HEADER
// ============================================================================

function Header({ tick, secondsToNext, paused, setPaused, director, setDirector }) {
const [now, setNow] = useState(new Date());
useEffect(() => {
const i = setInterval(() => setNow(new Date()), 1000);
return () => clearInterval(i);
}, []);
const seasonDay = Math.floor(tick / 12) + 1;

return (
<div style={{ backgroundColor: T.parchmentLight, borderBottom: `2px solid ${T.paperLine}`, position: ‘relative’ }}>
<div style={{ height: 4, background: `repeating-linear-gradient(90deg, ${T.gold} 0 12px, ${T.goldDeep} 12px 14px, ${T.gold} 14px 26px, ${T.navy} 26px 28px)` }} />

```
  <div className="flex items-stretch" style={{ padding: '14px 24px', gap: 24 }}>
    <div className="flex items-center" style={{ gap: 14 }}>
      <div style={{
        width: 52, height: 52, position: 'relative',
        backgroundColor: T.navy, border: `2px solid ${T.gold}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: T.goldLight, boxShadow: `inset 0 0 0 1px ${T.navyLight}`,
      }}>
        <Crown size={26} strokeWidth={1.6} />
        <div style={{
          position: 'absolute', bottom: -4, left: '50%', transform: 'translateX(-50%)',
          width: 0, height: 0,
          borderLeft: '6px solid transparent', borderRight: '6px solid transparent',
          borderTop: `6px solid ${T.gold}`,
        }} />
      </div>
      <div>
        <div style={{ fontFamily: FONT_DISPLAY, fontSize: 22, fontWeight: 700,
                      letterSpacing: '0.15em', color: T.navy, lineHeight: 1 }}>CLANWORLD</div>
        <div style={{ fontFamily: FONT_BODY, fontSize: 12, fontStyle: 'italic',
                      color: T.inkMute, letterSpacing: '0.04em', marginTop: 2 }}>
          Strategic Cockpit · Season I
        </div>
      </div>
    </div>

    <div style={{ width: 1, backgroundColor: T.paperLine }} />

    <div className="flex items-center flex-1" style={{ gap: 28 }}>
      <BigStat label="TICK" value={String(tick).padStart(4, '0')} accent={T.navy} />
      <BigStat label="HEARTBEAT" value={`${secondsToNext}s`} accent={T.statusGood} pulsing />
      <BigStat label="DAY" value={`${seasonDay}/30`} accent={T.gold} />
      <BigStat label="CLOCK" value={now.toLocaleTimeString('en-US', { hour12: false })} accent={T.inkSoft} mono />
    </div>

    <div className="flex items-center" style={{ gap: 8 }}>
      <ToggleButton active={director} onClick={() => setDirector(d => !d)} icon={<Wand2 size={14} />}>DIRECTOR</ToggleButton>
      <ToggleButton active={!paused} onClick={() => setPaused(p => !p)} icon={paused ? <Play size={14} /> : <Pause size={14} />}>
        {paused ? 'RESUME' : 'PAUSE'}
      </ToggleButton>
    </div>
  </div>

  <div style={{ height: 2, background: `linear-gradient(90deg, transparent, ${T.gold} 20%, ${T.gold} 80%, transparent)`, opacity: 0.5 }} />
</div>
```

);
}

function BigStat({ label, value, accent = T.ink, pulsing, mono }) {
return (
<div>
<div style={{ fontFamily: FONT_DISPLAY, fontSize: 9, letterSpacing: ‘0.22em’,
color: T.inkMute, marginBottom: 2 }}>{label}</div>
<div style={{ fontFamily: mono ? FONT_MONO : FONT_DISPLAY,
fontSize: 22, fontWeight: 700, color: accent, lineHeight: 1,
animation: pulsing ? ‘softPulse 2s ease-in-out infinite’ : undefined }}>
{value}
</div>
</div>
);
}

function ToggleButton({ active, onClick, children, icon }) {
return (
<button onClick={onClick} style={{
display: ‘flex’, alignItems: ‘center’, gap: 6,
fontFamily: FONT_DISPLAY, fontSize: 10, letterSpacing: ‘0.18em’, fontWeight: 600,
padding: ‘8px 14px’,
backgroundColor: active ? T.navy : T.parchment,
color: active ? T.goldLight : T.ink,
border: `1px solid ${active ? T.gold : T.paperLine}`,
cursor: ‘pointer’, transition: ‘all 0.15s’,
}}>{icon}{children}</button>
);
}

// ============================================================================
// ALERTS TICKER
// ============================================================================

function AlertsTicker() {
const alerts = [
{ icon: <AlertTriangle size={11} />, text: ‘BANDITS · East Farmland · 2 ticks to attack’, color: T.statusDanger },
{ icon: <Coins size={11} />, text: ‘ALPHA → BETA · 5g for defense contract’, color: T.statusInfo },
{ icon: <Activity size={11} />, text: ‘WOOD −9% · GAMMA dumped 15 wheat’, color: T.statusWarn },
{ icon: <Building2 size={11} />, text: ‘GAMMA · Monument reached L5’, color: T.statusGood },
{ icon: <Snowflake size={11} />, text: ‘WINTER inbound · 12 ticks remain’, color: T.statusInfo },
{ icon: <Skull size={11} />, text: ‘GAMMA STARVING · cold damage accruing’, color: T.statusDanger },
{ icon: <Sparkles size={11} />, text: ‘BLUEPRINT FRAGMENT moved DELTA → GAMMA’, color: T.gold },
{ icon: <Eye size={11} />, text: ‘AXL volume rising · 7 msgs / last 5 ticks’, color: T.statusInfo },
];
return (
<div style={{
backgroundColor: T.parchmentDeep,
borderTop: `1px solid ${T.paperLine}`,
borderBottom: `1px solid ${T.paperLine}`,
overflow: ‘hidden’, position: ‘relative’,
}}>
<div className=“flex items-center” style={{
padding: ‘6px 0’, animation: ‘tickerScroll 60s linear infinite’, whiteSpace: ‘nowrap’,
}}>
{[…alerts, …alerts].map((a, i) => (
<div key={i} className=“flex items-center” style={{
color: a.color, fontFamily: FONT_BODY, fontSize: 13,
padding: ‘0 24px’, gap: 8, borderRight: `1px solid ${T.paperLine}`,
}}>
{a.icon}<span style={{ fontWeight: 500 }}>{a.text}</span>
</div>
))}
</div>
</div>
);
}

// ============================================================================
// TAB NAV
// ============================================================================

const TABS = [
{ id: ‘world’,     label: ‘WORLD’,     icon: Compass },
{ id: ‘market’,    label: ‘MARKET’,    icon: Coins },
{ id: ‘diplomacy’, label: ‘DIPLOMACY’, icon: Network },
{ id: ‘cognition’, label: ‘COGNITION’, icon: Brain },
{ id: ‘chain’,     label: ‘CHAIN’,     icon: Database },
];

function TabNav({ active, setActive }) {
return (
<div className=“flex items-end” style={{
backgroundColor: T.parchment, borderBottom: `2px solid ${T.navy}`,
padding: ‘0 24px’, gap: 2,
}}>
{TABS.map(t => {
const isActive = active === t.id;
const Icon = t.icon;
return (
<button key={t.id} onClick={() => setActive(t.id)} style={{
display: ‘flex’, alignItems: ‘center’, gap: 8,
fontFamily: FONT_DISPLAY, fontSize: 11, letterSpacing: ‘0.22em’, fontWeight: 600,
padding: ‘12px 22px’,
backgroundColor: isActive ? T.navy : ‘transparent’,
color: isActive ? T.goldLight : T.inkSoft,
border: ‘none’,
borderTop: `2px solid ${isActive ? T.gold : 'transparent'}`,
borderLeft: `1px solid ${isActive ? T.gold : 'transparent'}`,
borderRight: `1px solid ${isActive ? T.gold : 'transparent'}`,
cursor: ‘pointer’, position: ‘relative’, top: 2, transition: ‘all 0.15s’,
}}>
<Icon size={13} strokeWidth={1.8} />
{t.label}
</button>
);
})}
</div>
);
}

// ============================================================================
// WORLD VIEW
// ============================================================================

function WorldView({ tick }) {
return (
<div style={{ padding: 20 }}>
<MissionTimeline tick={tick} />
<div style={{ height: 18 }} />
<div className=“grid” style={{ gridTemplateColumns: ‘1fr 1.4fr’, gap: 18 }}>
<WorldMap tick={tick} />
<ClanRoster />
</div>
</div>
);
}

function MissionTimeline({ tick }) {
const [zoom, setZoom] = useState(60);
const startTick = Math.max(0, tick - zoom);
const visibleTicks = Math.max(1, tick - startTick);

const worldEvents = useMemo(() => generateWorldEvents(tick).filter(e => e.tick >= startTick), [tick, startTick]);
const missions = useMemo(() =>
ALL_CLANSMEN.map(cm => ({
…cm,
segments: generateMissionHistory(cm.id, tick).filter(s => s.end >= startTick)
})), [tick, startTick]);

const phaseStyle = (phase, color) => {
if (phase === ‘TRAVELING’) return { background: `repeating-linear-gradient(90deg, ${color} 0 6px, transparent 6px 11px)` };
if (phase === ‘ACTING’)    return { backgroundColor: color };
if (phase === ‘WAITING’)   return { background: `repeating-linear-gradient(90deg, ${color} 0 2px, transparent 2px 5px)`, opacity: 0.7 };
if (phase === ‘DEFENDING’) return { background: `repeating-linear-gradient(45deg, ${color} 0 4px, ${T.parchmentLight} 4px 8px)` };
return { backgroundColor: color };
};

const tickToPct = t => `${((t - startTick) / visibleTicks) * 100}%`;

const worldEventColor = kind => {
if (kind.startsWith(‘WINTER’)) return T.statusInfo;
if (kind.startsWith(‘BANDIT’)) return T.statusDanger;
if (kind === ‘MONUMENT’)       return T.gold;
return T.inkMute;
};

return (
<Panel accent={T.navy}>
<BannerTitle subtitle="Clan and clansman activity over recent ticks">MISSION TIMELINE</BannerTitle>

```
  <div className="flex items-center justify-between mb-3" style={{ gap: 12 }}>
    <div className="flex items-center" style={{ gap: 6 }}>
      <span style={{ fontFamily: FONT_DISPLAY, fontSize: 9, letterSpacing: '0.18em', color: T.inkMute }}>WINDOW</span>
      {[20, 40, 60, 120].map(z => (
        <button key={z} onClick={() => setZoom(z)} style={{
          fontFamily: FONT_MONO, fontSize: 11, padding: '4px 10px',
          backgroundColor: zoom === z ? T.navy : T.parchment,
          color: zoom === z ? T.goldLight : T.inkSoft,
          border: `1px solid ${zoom === z ? T.gold : T.paperLine}`, cursor: 'pointer',
        }}>{z}T</button>
      ))}
    </div>
    <div className="flex items-center" style={{ gap: 14, fontFamily: FONT_BODY, fontSize: 11, color: T.inkSoft }}>
      <LegendSwatch label="Travel" sample={{ background: `repeating-linear-gradient(90deg, ${T.ink} 0 6px, transparent 6px 11px)` }} />
      <LegendSwatch label="Action" sample={{ backgroundColor: T.ink }} />
      <LegendSwatch label="Defend" sample={{ background: `repeating-linear-gradient(45deg, ${T.ink} 0 4px, ${T.parchmentLight} 4px 8px)` }} />
      <LegendSwatch label="Wait"   sample={{ background: `repeating-linear-gradient(90deg, ${T.ink} 0 2px, transparent 2px 5px)`, opacity: 0.7 }} />
    </div>
  </div>

  <div className="flex" style={{ marginLeft: 100, position: 'relative', height: 18 }}>
    {Array.from({ length: 7 }).map((_, i) => {
      const t = Math.floor(startTick + (i / 6) * visibleTicks);
      return (
        <div key={i} style={{
          position: 'absolute', left: `${(i / 6) * 100}%`, top: 0,
          fontFamily: FONT_MONO, fontSize: 10, color: T.inkMute, transform: 'translateX(-50%)',
        }}>T{t}</div>
      );
    })}
  </div>

  <div className="flex items-center" style={{ gap: 8 }}>
    <div style={{ width: 92, fontFamily: FONT_DISPLAY, fontSize: 9, letterSpacing: '0.16em', color: T.inkSoft, textAlign: 'right' }}>
      WORLD ·
    </div>
    <div style={{ flex: 1, position: 'relative', height: 28, backgroundColor: T.parchmentDeep, border: `1px solid ${T.paperLine}` }}>
      {worldEvents.map((e, i) => (
        <div key={i} style={{
          position: 'absolute', left: tickToPct(e.tick), top: 4, bottom: 4,
          transform: 'translateX(-50%)',
          backgroundColor: worldEventColor(e.kind), color: T.parchmentLight,
          fontFamily: FONT_DISPLAY, fontSize: 8, letterSpacing: '0.12em', fontWeight: 700,
          padding: '0 6px', display: 'flex', alignItems: 'center',
          border: `1px solid ${T.parchmentLight}`,
        }}>{e.label}</div>
      ))}
      <div style={{ position: 'absolute', left: tickToPct(tick), top: -4, bottom: -4,
                    width: 2, backgroundColor: T.statusDanger }} />
    </div>
  </div>

  <div style={{ height: 4 }} />

  {CLANS.map(clan => (
    <div key={clan.id}>
      <div className="flex items-center" style={{ gap: 8, marginTop: 8 }}>
        <div style={{ width: 92 }} className="flex items-center justify-end">
          <div className="flex items-center" style={{ gap: 6 }}>
            <span style={{ fontFamily: FONT_DISPLAY, fontSize: 11, letterSpacing: '0.16em', color: clan.ink, fontWeight: 700 }}>{clan.name}</span>
            <ClanSigil clan={clan} size={20} />
          </div>
        </div>
        <div style={{ flex: 1 }}>
          {missions.filter(m => m.clanName === clan.name).map(cm => (
            <div key={cm.id} className="flex items-center" style={{ gap: 6, marginBottom: 4 }}>
              <div style={{ width: 28, fontFamily: FONT_MONO, fontSize: 10, color: T.inkSoft, textAlign: 'right' }}>{cm.id}</div>
              <div style={{
                flex: 1, position: 'relative', height: 18,
                backgroundColor: T.parchment,
                border: `1px solid ${T.paperLine}`,
                borderLeftColor: clan.color, borderLeftWidth: 2,
              }}>
                {cm.segments.map((seg, i) => (
                  <div key={i} style={{
                    position: 'absolute',
                    left: tickToPct(Math.max(seg.start, startTick)),
                    width: `${((seg.end - Math.max(seg.start, startTick)) / visibleTicks) * 100}%`,
                    top: 2, bottom: 2,
                    ...phaseStyle(seg.phase, clan.color),
                    cursor: 'pointer',
                  }} title={`${cm.id} · ${seg.action} · T${seg.start}–${seg.end}`}>
                    {seg.start >= startTick && (
                      <div style={{
                        position: 'absolute', left: -3, top: 4,
                        width: 6, height: 6, borderRadius: 3,
                        backgroundColor: clan.color,
                        border: `1px solid ${T.parchmentLight}`,
                      }} />
                    )}
                  </div>
                ))}
                <div style={{
                  position: 'absolute', left: tickToPct(tick), top: -2, bottom: -2,
                  width: 2, backgroundColor: T.statusDanger, opacity: 0.7,
                }} />
              </div>
            </div>
          ))}
        </div>
      </div>
      {clan.id < 4 && <div style={{ height: 1, marginLeft: 100, background: T.paperLine, opacity: 0.4, marginTop: 6 }} />}
    </div>
  ))}
</Panel>
```

);
}

function LegendSwatch({ label, sample }) {
return (
<div className=“flex items-center” style={{ gap: 6 }}>
<div style={{ width: 22, height: 8, …sample }} />
<span>{label}</span>
</div>
);
}

function WorldMap({ tick }) {
const map = [
[
{ name: ‘MOUNTAINS’,     color: T.rgnMountains, icon: Mountain, clans: [‘BETA’] },
{ name: ‘FOREST’,        color: T.rgnForest,    icon: Trees,    clans: [‘ALPHA’] },
{ name: ‘EAST FARMLAND’, color: T.rgnEastFarm,  icon: Wheat,    clans: [‘GAMMA’], bandit: true },
],
[
{ name: ‘WEST FARMLAND’, color: T.rgnWestFarm,  icon: Wheat,    clans: [] },
{ name: ‘UNICORN TOWN’,  color: T.rgnUnicorn,   icon: Sparkles, clans: [] },
{ name: ‘EAST DOCKS’,    color: T.rgnEastDock,  icon: Anchor,   clans: [] },
],
[
{ name: ‘WEST DOCKS’,    color: T.rgnWestDock,  icon: Anchor,   clans: [‘DELTA’] },
{ name: ‘DEEP SEA’,      color: T.rgnDeepSea,   icon: Fish,     clans: [] },
{ name: ‘— —’,           color: T.parchmentDeep, icon: null,    clans: [] },
],
];

return (
<Panel accent={T.navy}>
<BannerTitle subtitle="Eight regions · four clans · one bandit troop">REALM MAP</BannerTitle>
<div className=“grid” style={{ gridTemplateColumns: ‘repeat(3, 1fr)’, gap: 6 }}>
{map.flat().map((cell, i) => {
const Icon = cell.icon;
if (!Icon) return <div key={i} style={{ aspectRatio: ‘1.2’, backgroundColor: T.parchmentDeep, opacity: 0.4 }} />;
return (
<div key={i} style={{
aspectRatio: ‘1.2’, position: ‘relative’,
backgroundColor: cell.color,
border: `2px solid ${T.parchmentLight}`,
boxShadow: `inset 0 0 0 1px rgba(0,0,0,0.15), 0 1px 0 ${T.parchmentShadow}`,
padding: 6,
display: ‘flex’, flexDirection: ‘column’, justifyContent: ‘space-between’,
color: T.parchmentLight, overflow: ‘hidden’,
}}>
<div className="flex items-start justify-between">
<span style={{ fontFamily: FONT_DISPLAY, fontSize: 9, letterSpacing: ‘0.12em’, fontWeight: 700, lineHeight: 1.1 }}>
{cell.name}
</span>
<Icon size={14} strokeWidth={1.6} style={{ opacity: 0.85 }} />
</div>
<div className="flex items-end justify-between">
<div className=“flex” style={{ gap: 4 }}>
{cell.clans.map(cn => {
const cl = CLAN_BY_NAME[cn];
return <ClanSigil key={cn} clan={cl} size={18} />;
})}
</div>
{cell.bandit && (
<div style={{
backgroundColor: T.statusDanger, color: T.parchmentLight,
fontFamily: FONT_DISPLAY, fontSize: 8, letterSpacing: ‘0.12em’,
padding: ‘2px 5px’, fontWeight: 700,
display: ‘flex’, alignItems: ‘center’, gap: 3,
}}><Skull size={10} /> RAID</div>
)}
</div>
</div>
);
})}
</div>

```
  <div style={{ height: 12 }} />
  <DividerOrnament />
  <div style={{ height: 8 }} />

  <div className="flex items-center justify-between" style={{ fontFamily: FONT_BODY, fontSize: 11, color: T.inkSoft }}>
    <div className="flex items-center" style={{ gap: 6 }}>
      <Compass size={16} style={{ color: T.gold }} />
      <span style={{ fontStyle: 'italic' }}>Tile = 1 region · Travel cost varies</span>
    </div>
    <div style={{ fontFamily: FONT_MONO, fontSize: 10, color: T.inkMute }}>
      T{tick} · 8 regions · 1 active troop
    </div>
  </div>
</Panel>
```

);
}

function ClanRoster() {
return (
<Panel accent={T.navy}>
<BannerTitle subtitle="Vault, garrison, and standing">CLAN ROSTER</BannerTitle>
<div className=“grid” style={{ gridTemplateColumns: ‘1fr 1fr’, gap: 12 }}>
{CLANS.map(c => <ClanCard key={c.id} clan={c} />)}
</div>
</Panel>
);
}

function ClanCard({ clan }) {
const badges = [];
if (clan.starving) badges.push({ label: ‘STARVING’, color: T.statusDanger });
if (clan.status === ‘BANDIT-TARGET’) badges.push({ label: ‘BANDIT TARGET’, color: T.statusDanger });
if (clan.status === ‘WINTER-READY’) badges.push({ label: ‘WINTER READY’, color: T.statusGood });
if (clan.status === ‘CASH-RICH’) badges.push({ label: ‘CASH-RICH’, color: T.gold });

return (
<div style={{
backgroundColor: T.parchment, border: `1px solid ${T.paperLine}`,
borderLeft: `3px solid ${clan.color}`, padding: 12,
}}>
<div className=“flex items-start justify-between” style={{ marginBottom: 8 }}>
<div className=“flex items-center” style={{ gap: 8 }}>
<ClanSigil clan={clan} size={28} />
<div>
<div style={{ fontFamily: FONT_DISPLAY, fontSize: 14, fontWeight: 700,
letterSpacing: ‘0.12em’, color: clan.ink, lineHeight: 1 }}>{clan.name}</div>
<div style={{ fontFamily: FONT_BODY, fontSize: 11, fontStyle: ‘italic’,
color: T.inkMute, marginTop: 2 }}>”{clan.motto}”</div>
</div>
</div>
<div className=“flex flex-col items-end” style={{ gap: 3 }}>
{badges.map((b, i) => <StatusSeal key={i} color={b.color}>{b.label}</StatusSeal>)}
</div>
</div>

```
  <div style={{ fontFamily: FONT_BODY, fontSize: 11, color: T.inkSoft, marginBottom: 8 }}>
    Base in <span style={{ fontWeight: 700, color: clan.regionColor }}>{clan.region}</span> · {clan.clansmen.length} clansmen
  </div>

  <div className="grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginBottom: 8 }}>
    <LabelValue label="GOLD" value={clan.gold.toFixed(1)} color={T.resGold} />
    <LabelValue label="BASE" value={`L${clan.baseLevel}`} />
    <LabelValue label="WALL" value={`L${clan.wallLevel}`} />
    <LabelValue label="MNMT" value={`L${clan.monumentLevel}`} color={T.gold} />
  </div>

  <div className="grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', gap: 4, marginBottom: 6 }}>
    <ResourceBar label="WD" value={clan.vault.wood}  max={50} color={T.resWood} />
    <ResourceBar label="IR" value={clan.vault.iron}  max={25} color={T.resIron} />
    <ResourceBar label="WH" value={clan.vault.wheat} max={80} color={T.resWheat} />
    <ResourceBar label="FH" value={clan.vault.fish}  max={20} color={T.resFish} />
  </div>

  {clan.blueprint > 0 && (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}>
      <Sparkles size={11} style={{ color: T.gold }} />
      <span style={{ fontFamily: FONT_BODY, fontSize: 11, color: T.gold, fontStyle: 'italic' }}>
        {clan.blueprint} blueprint fragment{clan.blueprint > 1 ? 's' : ''}
      </span>
    </div>
  )}
</div>
```

);
}

function ResourceBar({ label, value, max, color }) {
const pct = Math.min(100, (value / max) * 100);
return (
<div>
<div className=“flex justify-between” style={{
fontSize: 9, fontFamily: FONT_DISPLAY, letterSpacing: ‘0.1em’, color: T.inkMute, marginBottom: 2,
}}>
<span>{label}</span>
<span style={{ fontFamily: FONT_MONO, color: T.ink, fontWeight: 600 }}>{value}</span>
</div>
<div style={{ height: 4, backgroundColor: T.parchmentDeep, position: ‘relative’ }}>
<div style={{ position: ‘absolute’, left: 0, top: 0, bottom: 0, width: `${pct}%`, backgroundColor: color }} />
</div>
</div>
);
}

// ============================================================================
// MARKET VIEW
// ============================================================================

function MarketView({ tick }) {
const priceHistory = useMemo(() => generatePriceHistory(tick, 80), [tick]);
const portfolios = CLANS.map(c => ({
name: c.name, color: c.color,
data: [
{ stat: ‘GOLD’,  v: c.gold * 2 },
{ stat: ‘WHEAT’, v: c.vault.wheat },
{ stat: ‘FISH’,  v: c.vault.fish * 4 },
{ stat: ‘WOOD’,  v: c.vault.wood },
{ stat: ‘IRON’,  v: c.vault.iron * 3 },
]
}));

return (
<div style={{ padding: 20 }}>
<div className=“grid” style={{ gridTemplateColumns: ‘repeat(4, 1fr)’, gap: 14, marginBottom: 18 }}>
<PricePanel name="WOOD"  resource="wood"  color={T.resWood}  data={priceHistory} icon={Trees} />
<PricePanel name="WHEAT" resource="wheat" color={T.resWheat} data={priceHistory} icon={Wheat} />
<PricePanel name="FISH"  resource="fish"  color={T.resFish}  data={priceHistory} icon={Fish} />
<PricePanel name="IRON"  resource="iron"  color={T.resIron}  data={priceHistory} icon={Hammer} />
</div>

```
  <div className="grid" style={{ gridTemplateColumns: '1.4fr 1fr', gap: 18, marginBottom: 18 }}>
    <TradeLog />
    <ShockFeed />
  </div>

  <div className="grid" style={{ gridTemplateColumns: '1.4fr 1fr', gap: 18 }}>
    <PortfolioRadar portfolios={portfolios} />
    <ResourceDistribution />
  </div>
</div>
```

);
}

function PricePanel({ name, resource, color, data, icon: Icon }) {
const latest = data[data.length - 1]?.[resource] || 0;
const earlier = data[Math.max(0, data.length - 30)]?.[resource] || latest;
const changePct = ((latest - earlier) / earlier) * 100;
const isUp = changePct >= 0;
return (
<Panel accent={color} padded={false}>
<div style={{ padding: ‘14px 14px 0 14px’ }}>
<div className=“flex items-center justify-between” style={{ marginBottom: 8 }}>
<div className=“flex items-center” style={{ gap: 8 }}>
<Icon size={16} style={{ color }} strokeWidth={1.8} />
<div style={{ fontFamily: FONT_DISPLAY, fontSize: 13, letterSpacing: ‘0.18em’, fontWeight: 700, color: T.ink }}>
{name}/GOLD
</div>
</div>
<span style={{
fontFamily: FONT_DISPLAY, fontSize: 9, letterSpacing: ‘0.12em’,
color: isUp ? T.statusGood : T.statusDanger, fontWeight: 700,
}}>
{isUp ? ‘▲’ : ‘▼’} {Math.abs(changePct).toFixed(1)}%
</span>
</div>
<div style={{ fontFamily: FONT_MONO, fontSize: 26, color, fontWeight: 700, lineHeight: 1, marginBottom: 4 }}>
{latest.toFixed(3)}
<span style={{ fontFamily: FONT_BODY, fontSize: 11, color: T.inkMute, fontWeight: 400, marginLeft: 6, fontStyle: ‘italic’ }}>
gold per unit
</span>
</div>
</div>
<div style={{ height: 80, marginTop: 4 }}>
<ResponsiveContainer width="100%" height="100%">
<AreaChart data={data} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
<defs>
<linearGradient id={`grad-${resource}`} x1=“0” y1=“0” x2=“0” y2=“1”>
<stop offset="0%" stopColor={color} stopOpacity={0.45} />
<stop offset="100%" stopColor={color} stopOpacity={0.05} />
</linearGradient>
</defs>
<Area type=“monotone” dataKey={resource} stroke={color} strokeWidth={1.5}
fill={`url(#grad-${resource})`} dot={false} />
</AreaChart>
</ResponsiveContainer>
</div>
</Panel>
);
}

function TradeLog() {
return (
<Panel accent={T.navy}>
<BannerTitle subtitle="Uniswap pool swaps and clan-to-clan transfers">TRADE LEDGER</BannerTitle>
<div style={{ maxHeight: 320, overflowY: ‘auto’ }}>
<table style={{ width: ‘100%’, fontFamily: FONT_BODY, fontSize: 12, borderCollapse: ‘collapse’ }}>
<thead>
<tr style={{ borderBottom: `1px solid ${T.paperLine}` }}>
{[‘Tick’, ‘Venue’, ‘Clan’, ‘Action’, ‘Resource’, ‘Amt’, ‘Gold’].map(h => (
<th key={h} style={{
fontFamily: FONT_DISPLAY, fontSize: 9, letterSpacing: ‘0.16em’,
color: T.inkMute, textAlign: ‘left’, padding: ‘8px 10px’, fontWeight: 600,
}}>{h}</th>
))}
</tr>
</thead>
<tbody>
{MOCK_TRADES.map((t, i) => (
<tr key={i} style={{
backgroundColor: i % 2 === 0 ? T.parchment : ‘transparent’,
borderBottom: `1px solid ${T.paperLine}`,
}}>
<td style={{ padding: ‘7px 10px’, fontFamily: FONT_MONO, color: T.inkSoft }}>T{t.tick}</td>
<td style={{ padding: ‘7px 10px’ }}>
<span style={{
fontFamily: FONT_DISPLAY, fontSize: 9, letterSpacing: ‘0.14em’, fontWeight: 700,
color: t.type === ‘AMM’ ? T.statusInfo : T.gold,
}}>{t.type === ‘AMM’ ? ‘⌬ UNISWAP’ : ‘✦ OTC’}</span>
</td>
<td style={{ padding: ‘7px 10px’, fontFamily: FONT_DISPLAY, fontSize: 11, fontWeight: 700, color: CLAN_BY_NAME[t.clan]?.ink }}>
{t.clan}{t.counter ? ` → ${t.counter}` : ‘’}
</td>
<td style={{ padding: ‘7px 10px’, fontFamily: FONT_BODY, fontSize: 11, color: T.ink, fontStyle: ‘italic’ }}>
{t.dir || ‘transfer’}
</td>
<td style={{ padding: ‘7px 10px’, fontFamily: FONT_DISPLAY, fontSize: 11, color: T.inkSoft, letterSpacing: ‘0.06em’ }}>
{t.resource}
</td>
<td style={{ padding: ‘7px 10px’, fontFamily: FONT_MONO, color: T.ink, fontWeight: 600 }}>{t.amount}</td>
<td style={{ padding: ‘7px 10px’, fontFamily: FONT_MONO, color: T.resGold, fontWeight: 600 }}>
{t.gold ? t.gold.toFixed(1) : ‘—’}
</td>
</tr>
))}
</tbody>
</table>
</div>
</Panel>
);
}

function ShockFeed() {
return (
<Panel accent={T.gold}>
<BannerTitle accent={T.gold} subtitle="Auto-detected market events">MARKET CHRONICLES</BannerTitle>
<div style={{ display: ‘flex’, flexDirection: ‘column’, gap: 8 }}>
{MOCK_SHOCKS.map((s, i) => {
const sevColor = s.severity === ‘HIGH’ ? T.statusDanger : s.severity === ‘MID’ ? T.gold : T.statusInfo;
return (
<div key={i} style={{
backgroundColor: T.parchment,
borderLeft: `3px solid ${sevColor}`,
padding: ‘8px 10px’,
}}>
<div className=“flex items-center justify-between” style={{ marginBottom: 3 }}>
<span style={{ fontFamily: FONT_DISPLAY, fontSize: 9, letterSpacing: ‘0.14em’, color: sevColor, fontWeight: 700 }}>
T{s.tick} · {s.severity}
</span>
</div>
<div style={{ fontFamily: FONT_BODY, fontSize: 13, color: T.ink, lineHeight: 1.4, fontStyle: ‘italic’ }}>
“{s.text}”
</div>
</div>
);
})}
</div>
</Panel>
);
}

function PortfolioRadar({ portfolios }) {
const merged = portfolios[0].data.map((d, i) => ({
stat: d.stat,
ALPHA: portfolios[0].data[i].v,
BETA:  portfolios[1].data[i].v,
GAMMA: portfolios[2].data[i].v,
DELTA: portfolios[3].data[i].v,
}));
return (
<Panel accent={T.navy}>
<BannerTitle subtitle="Comparative resource holdings (vault)">TREASURY COMPASS</BannerTitle>
<div style={{ height: 280 }}>
<ResponsiveContainer width="100%" height="100%">
<RadarChart data={merged}>
<PolarGrid stroke={T.paperLine} />
<PolarAngleAxis dataKey=“stat” tick={{ fill: T.inkSoft, fontSize: 11, fontFamily: FONT_DISPLAY, letterSpacing: ‘0.1em’ }} />
<Radar name="ALPHA" dataKey="ALPHA" stroke={T.alpha} fill={T.alpha} fillOpacity={0.15} strokeWidth={1.5} />
<Radar name="BETA"  dataKey="BETA"  stroke={T.beta}  fill={T.beta}  fillOpacity={0.15} strokeWidth={1.5} />
<Radar name="GAMMA" dataKey="GAMMA" stroke={T.gamma} fill={T.gamma} fillOpacity={0.15} strokeWidth={1.5} />
<Radar name="DELTA" dataKey="DELTA" stroke={T.delta} fill={T.delta} fillOpacity={0.15} strokeWidth={1.5} />
<Tooltip contentStyle={{ backgroundColor: T.parchmentLight, border: `1px solid ${T.paperLine}`, fontFamily: FONT_BODY }} />
</RadarChart>
</ResponsiveContainer>
</div>
<div className=“flex justify-center” style={{ gap: 16, marginTop: 4 }}>
{CLANS.map(c => (
<div key={c.id} className=“flex items-center” style={{ gap: 6 }}>
<div style={{ width: 10, height: 10, backgroundColor: c.color, border: `1px solid ${c.ink}` }} />
<span style={{ fontFamily: FONT_DISPLAY, fontSize: 10, letterSpacing: ‘0.12em’, color: c.ink, fontWeight: 700 }}>{c.name}</span>
</div>
))}
</div>
</Panel>
);
}

function ResourceDistribution() {
const total = {
wood:  CLANS.reduce((s, c) => s + c.vault.wood, 0),
iron:  CLANS.reduce((s, c) => s + c.vault.iron, 0),
wheat: CLANS.reduce((s, c) => s + c.vault.wheat, 0),
fish:  CLANS.reduce((s, c) => s + c.vault.fish, 0),
gold:  CLANS.reduce((s, c) => s + c.gold, 0),
};
const resources = [
{ name: ‘WOOD’,  total: total.wood,  color: T.resWood },
{ name: ‘IRON’,  total: total.iron,  color: T.resIron },
{ name: ‘WHEAT’, total: total.wheat, color: T.resWheat },
{ name: ‘FISH’,  total: total.fish,  color: T.resFish },
{ name: ‘GOLD’,  total: total.gold,  color: T.resGold },
];
return (
<Panel accent={T.navy}>
<BannerTitle subtitle="Realm-wide totals by clan">WORLD STORES</BannerTitle>
<div style={{ display: ‘flex’, flexDirection: ‘column’, gap: 12 }}>
{resources.map(r => (
<div key={r.name}>
<div className=“flex items-center justify-between” style={{ marginBottom: 4 }}>
<span style={{ fontFamily: FONT_DISPLAY, fontSize: 11, letterSpacing: ‘0.16em’, fontWeight: 700, color: r.color }}>{r.name}</span>
<span style={{ fontFamily: FONT_MONO, fontSize: 13, color: T.ink, fontWeight: 600 }}>{r.total.toFixed(1)}</span>
</div>
<div className=“flex” style={{ height: 12, backgroundColor: T.parchmentDeep, border: `1px solid ${T.paperLine}` }}>
{CLANS.map(c => {
const v = r.name === ‘GOLD’ ? c.gold : c.vault[r.name.toLowerCase()];
const pct = (v / r.total) * 100;
return (
<div key={c.id} style={{
width: `${pct}%`,
backgroundColor: c.color,
borderRight: `1px solid ${T.parchmentLight}`,
}} title={`${c.name}: ${v.toFixed(1)}`} />
);
})}
</div>
</div>
))}
</div>
</Panel>
);
}

// ============================================================================
// DIPLOMACY VIEW
// ============================================================================

function DiplomacyView({ tick }) {
return (
<div style={{ padding: 20 }}>
<div className=“grid” style={{ gridTemplateColumns: ‘1.5fr 1fr’, gap: 18 }}>
<DiplomacyGraph tick={tick} />
<TrustMatrix />
</div>
<div style={{ height: 18 }} />
<MessageLog />
</div>
);
}

function DiplomacyGraph({ tick }) {
const [pulses, setPulses] = useState([]);
useEffect(() => {
const i = setInterval(() => {
const fromIdx = Math.floor(Math.random() * 4);
let toIdx = Math.floor(Math.random() * 4);
while (toIdx === fromIdx) toIdx = Math.floor(Math.random() * 4);
const broadcast = Math.random() < 0.2;
const intents = [‘TRADE’, ‘ALLIANCE’, ‘THREAT’, ‘MERCENARY’, ‘BROADCAST’];
const intent = broadcast ? ‘BROADCAST’ : intents[Math.floor(Math.random() * 4)];
const id = Math.random();
setPulses(p => […p, { id, fromIdx, toIdx, intent, broadcast }]);
setTimeout(() => setPulses(p => p.filter(x => x.id !== id)), 2400);
}, 1800);
return () => clearInterval(i);
}, []);

const positions = [
{ x: 80,  y: 60  },
{ x: 360, y: 60  },
{ x: 80,  y: 240 },
{ x: 360, y: 240 },
];

return (
<Panel accent={T.navy}>
<BannerTitle subtitle="Live AXL message graph (Gensyn channel)">DIPLOMATIC THEATRE</BannerTitle>
<div style={{ position: ‘relative’, height: 340, backgroundColor: T.parchment, border: `1px solid ${T.paperLine}` }}>
<svg width="100%" height="100%" viewBox="0 0 460 320" preserveAspectRatio="xMidYMid meet">
{[[0,1],[0,2],[0,3],[1,2],[1,3],[2,3]].map(([a, b], i) => (
<line key={i}
x1={positions[a].x + 50} y1={positions[a].y + 30}
x2={positions[b].x + 50} y2={positions[b].y + 30}
stroke={T.paperLine} strokeWidth=“1” strokeDasharray=“3,3” />
))}
{pulses.map(p => {
if (p.broadcast) {
return (
<circle key={p.id}
cx={positions[p.fromIdx].x + 50}
cy={positions[p.fromIdx].y + 30}
r=“8” fill=“none”
stroke={INTENT_COLOR[p.intent]}
strokeWidth=“2” opacity=“0.7”
style={{ animation: ‘broadcastRing 2.4s ease-out forwards’ }} />
);
}
const fx = positions[p.fromIdx].x + 50;
const fy = positions[p.fromIdx].y + 30;
const tx = positions[p.toIdx].x + 50;
const ty = positions[p.toIdx].y + 30;
return (
<g key={p.id}>
<line x1={fx} y1={fy} x2={tx} y2={ty}
stroke={INTENT_COLOR[p.intent]} strokeWidth="1.5" opacity="0.5" />
<circle r="5" fill={INTENT_COLOR[p.intent]}>
<animate attributeName="cx" from={fx} to={tx} dur="2.4s" fill="freeze" />
<animate attributeName="cy" from={fy} to={ty} dur="2.4s" fill="freeze" />
</circle>
</g>
);
})}
</svg>
{CLANS.map((c, i) => (
<div key={c.id} style={{
position: ‘absolute’,
left: `${(positions[i].x / 460) * 100}%`,
top: `${(positions[i].y / 320) * 100}%`,
width: 100, height: 60,
backgroundColor: T.parchmentLight,
border: `2px solid ${c.color}`,
display: ‘flex’, alignItems: ‘center’, justifyContent: ‘center’, gap: 8,
boxShadow: `inset 0 0 0 1px ${T.parchment}, 0 1px 0 ${T.parchmentShadow}`,
}}>
<ClanSigil clan={c} size={26} />
<div>
<div style={{ fontFamily: FONT_DISPLAY, fontSize: 11, letterSpacing: ‘0.14em’, fontWeight: 700, color: c.ink, lineHeight: 1 }}>{c.name}</div>
<div style={{ fontFamily: FONT_MONO, fontSize: 9, color: T.inkMute, marginTop: 2 }}>T{tick}</div>
</div>
</div>
))}
</div>
<div className=“flex justify-center” style={{ gap: 14, marginTop: 10, flexWrap: ‘wrap’ }}>
{Object.entries(INTENT_COLOR).map(([intent, color]) => (
<div key={intent} className=“flex items-center” style={{ gap: 5 }}>
<div style={{ width: 10, height: 3, backgroundColor: color }} />
<span style={{ fontFamily: FONT_DISPLAY, fontSize: 9, letterSpacing: ‘0.12em’, color: T.inkSoft, fontWeight: 600 }}>{intent}</span>
</div>
))}
</div>
</Panel>
);
}

function TrustMatrix() {
return (
<Panel accent={T.navy}>
<BannerTitle subtitle="Promises kept and broken">TRUST LEDGER</BannerTitle>
<table style={{ width: ‘100%’, fontFamily: FONT_MONO, fontSize: 13, borderCollapse: ‘collapse’ }}>
<thead>
<tr>
<th></th>
{CLANS.map(c => (
<th key={c.id} style={{
fontFamily: FONT_DISPLAY, fontSize: 10, letterSpacing: ‘0.14em’,
color: c.ink, padding: 8, fontWeight: 700,
}}>{c.name}</th>
))}
</tr>
</thead>
<tbody>
{TRUST_MATRIX.map((row, i) => (
<tr key={i}>
<td style={{ fontFamily: FONT_DISPLAY, fontSize: 10, letterSpacing: ‘0.14em’, color: CLANS[i].ink, padding: 8, fontWeight: 700 }}>
{CLANS[i].name}
</td>
{row.map((v, j) => {
if (v === null) return <td key={j} style={{ textAlign: ‘center’, padding: 8, color: T.inkMute }}>—</td>;
const color = v > 0 ? T.statusGood : v < 0 ? T.statusDanger : T.inkMute;
return (
<td key={j} style={{
textAlign: ‘center’, padding: 8,
color, fontWeight: 700, fontSize: 14,
backgroundColor: v > 0 ? `${T.statusGood}15` : v < 0 ? `${T.statusDanger}15` : ‘transparent’,
}}>{v > 0 ? `+${v}` : v}</td>
);
})}
</tr>
))}
</tbody>
</table>
<div style={{ height: 12 }} />
<DividerOrnament />
<div style={{ fontFamily: FONT_BODY, fontSize: 11, color: T.inkSoft, fontStyle: ‘italic’, marginTop: 10, lineHeight: 1.5 }}>
Trust shifts with every promise honored or broken. Read row to column: how clan A regards clan B.
Updated each tick from message tone and contract fulfillment.
</div>
</Panel>
);
}

function MessageLog() {
const [expanded, setExpanded] = useState(null);
return (
<Panel accent={T.navy}>
<BannerTitle subtitle="All AXL traffic, intent-tagged by sending agent">DISPATCH LOG</BannerTitle>
<table style={{ width: ‘100%’, fontFamily: FONT_BODY, fontSize: 12, borderCollapse: ‘collapse’ }}>
<thead>
<tr style={{ borderBottom: `1px solid ${T.paperLine}` }}>
{[‘Tick’, ‘From’, ‘To’, ‘Intent’, ‘Summary’].map(h => (
<th key={h} style={{
fontFamily: FONT_DISPLAY, fontSize: 9, letterSpacing: ‘0.16em’,
color: T.inkMute, textAlign: ‘left’, padding: ‘8px 10px’, fontWeight: 600,
}}>{h}</th>
))}
</tr>
</thead>
<tbody>
{MOCK_MESSAGES.map((m, i) => (
<Fragment key={i}>
<tr onClick={() => setExpanded(expanded === i ? null : i)}
style={{
backgroundColor: i % 2 === 0 ? T.parchment : ‘transparent’,
borderBottom: `1px solid ${T.paperLine}`,
cursor: ‘pointer’,
}}>
<td style={{ padding: ‘7px 10px’, fontFamily: FONT_MONO, color: T.inkSoft }}>T{m.tick}</td>
<td style={{ padding: ‘7px 10px’, fontFamily: FONT_DISPLAY, fontSize: 11, fontWeight: 700, color: CLAN_BY_NAME[m.from]?.ink }}>{m.from}</td>
<td style={{ padding: ‘7px 10px’, fontFamily: FONT_DISPLAY, fontSize: 11, fontWeight: 700, color: m.to === ‘ALL’ ? T.gold : CLAN_BY_NAME[m.to]?.ink }}>{m.to}</td>
<td style={{ padding: ‘7px 10px’ }}>
<span style={{
fontFamily: FONT_DISPLAY, fontSize: 9, letterSpacing: ‘0.14em’, fontWeight: 700,
color: T.parchmentLight, backgroundColor: INTENT_COLOR[m.intent], padding: ‘3px 8px’,
}}>{m.intent}</span>
</td>
<td style={{ padding: ‘7px 10px’, fontFamily: FONT_BODY, color: T.ink, fontStyle: ‘italic’ }}>”{m.summary}”</td>
</tr>
{expanded === i && (
<tr>
<td colSpan={5} style={{
backgroundColor: T.parchmentDeep, padding: ‘10px 14px’,
fontFamily: FONT_BODY, fontSize: 12, color: T.inkSoft, lineHeight: 1.5,
}}>
<div style={{ fontFamily: FONT_DISPLAY, fontSize: 9, letterSpacing: ‘0.14em’, color: T.inkMute, marginBottom: 4 }}>
FULL DISPATCH · TICK {m.tick}
</div>
“{m.summary}” Sent via Gensyn AXL channel from {m.from} to {m.to}.
Intent classifier: <span style={{ fontWeight: 700, color: INTENT_COLOR[m.intent] }}>{m.intent}</span>.
No on-chain effect; trust matrix updated from message sentiment.
</td>
</tr>
)}
</Fragment>
))}
</tbody>
</table>
</Panel>
);
}

// ============================================================================
// COGNITION VIEW
// ============================================================================

function CognitionView() {
return (
<div style={{ padding: 20 }}>
<div className=“grid” style={{ gridTemplateColumns: ‘repeat(2, 1fr)’, gap: 18 }}>
{CLANS.map(c => <AgentBlackBox key={c.id} clan={c} />)}
</div>
</div>
);
}

function AgentBlackBox({ clan }) {
const inf = MOCK_INFERENCE[clan.name];
const mem = MOCK_MEMORY[clan.name];

return (
<Panel accent={clan.color}>
<div className=“flex items-center justify-between” style={{ marginBottom: 14 }}>
<div className=“flex items-center” style={{ gap: 12 }}>
<ClanSigil clan={clan} size={36} />
<div>
<div style={{ fontFamily: FONT_DISPLAY, fontSize: 16, fontWeight: 700, letterSpacing: ‘0.14em’, color: clan.ink, lineHeight: 1 }}>
{clan.name} ELDER
</div>
<div style={{ fontFamily: FONT_BODY, fontSize: 11, fontStyle: ‘italic’, color: T.inkMute, marginTop: 3 }}>
{inf.model} · {inf.calls} inferences
</div>
</div>
</div>
<StatusSeal color={clan.color}>{clan.status}</StatusSeal>
</div>

```
  <CognitionLayer icon={Database} title="MEMORY" subtitle="0G STORAGE · durable" accent={T.statusInfo}>
    <div style={{ fontFamily: FONT_BODY, fontSize: 12, color: T.ink, fontStyle: 'italic', marginBottom: 8, lineHeight: 1.4 }}>
      "{mem.strategy}"
    </div>
    <div className="grid" style={{ gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
      <MemList label="ALLIES"   items={mem.allies}    color={T.statusGood} />
      <MemList label="ENEMIES"  items={mem.enemies}   color={T.statusDanger} />
      <MemList label="PROMISES" items={mem.promises}  color={T.gold} />
      <MemList label="GOALS"    items={mem.goals}     color={T.statusInfo} />
    </div>
  </CognitionLayer>

  <div style={{ height: 10 }} />

  <CognitionLayer icon={Cpu} title="COMPUTE" subtitle="0G COMPUTE · live inference" accent={T.alpha}>
    <div className="grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 8 }}>
      <LabelValue label="TOKENS" value={inf.tokens.toLocaleString()} color={T.ink} />
      <LabelValue label="COST" value={inf.costZG.toFixed(4)} color={T.gold} suffix="0G" />
      <LabelValue label="LATENCY" value={inf.latencyMs} color={T.statusInfo} suffix="ms" />
    </div>
    <div style={{ fontFamily: FONT_DISPLAY, fontSize: 9, letterSpacing: '0.14em', color: T.inkMute, marginBottom: 4 }}>
      RECENT REASONING
    </div>
    {inf.recent.map((r, i) => (
      <div key={i} style={{
        fontFamily: FONT_BODY, fontSize: 11, color: T.inkSoft, marginBottom: 4,
        paddingLeft: 8, borderLeft: `2px solid ${T.alpha}`, lineHeight: 1.4,
      }}>
        <span style={{ fontFamily: FONT_MONO, fontSize: 10, color: T.inkMute, marginRight: 6 }}>T{r.tick}</span>
        <span style={{ fontStyle: 'italic' }}>"{r.prompt}"</span>
        <span style={{ fontFamily: FONT_MONO, fontSize: 10, color: T.inkMute, marginLeft: 6 }}>
          · {r.tokensIn}+{r.tokensOut}t · {r.ms}ms
        </span>
      </div>
    ))}
  </CognitionLayer>

  <div style={{ height: 10 }} />

  <CognitionLayer icon={Wrench} title="TOOLING" subtitle="On-chain action calls" accent={T.statusDanger}>
    <div className="grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
      <LabelValue label="MISSIONS" value={Math.floor(inf.calls * 0.8)} />
      <LabelValue label="TRADES"   value={Math.floor(inf.calls * 0.3)} />
      <LabelValue label="MSGS"     value={Math.floor(inf.calls * 0.5)} />
      <LabelValue label="DEPOSITS" value={Math.floor(inf.calls * 0.4)} />
    </div>
  </CognitionLayer>
</Panel>
```

);
}

function CognitionLayer({ icon: Icon, title, subtitle, accent, children }) {
return (
<div style={{
backgroundColor: T.parchment, border: `1px solid ${T.paperLine}`,
borderLeft: `3px solid ${accent}`, padding: 12,
}}>
<div className=“flex items-center justify-between” style={{ marginBottom: 10 }}>
<div className=“flex items-center” style={{ gap: 8 }}>
<Icon size={14} style={{ color: accent }} strokeWidth={1.8} />
<span style={{ fontFamily: FONT_DISPLAY, fontSize: 11, letterSpacing: ‘0.18em’, fontWeight: 700, color: T.ink }}>{title}</span>
</div>
<span style={{ fontFamily: FONT_BODY, fontSize: 10, fontStyle: ‘italic’, color: T.inkMute }}>{subtitle}</span>
</div>
{children}
</div>
);
}

function MemList({ label, items, color }) {
return (
<div>
<div style={{ fontFamily: FONT_DISPLAY, fontSize: 9, letterSpacing: ‘0.14em’, color, fontWeight: 700, marginBottom: 4 }}>
{label}
</div>
{items.length === 0 ? (
<div style={{ fontFamily: FONT_BODY, fontSize: 11, color: T.inkMute, fontStyle: ‘italic’ }}>—</div>
) : (
items.map((item, i) => (
<div key={i} style={{ fontFamily: FONT_BODY, fontSize: 11, color: T.ink, lineHeight: 1.4 }}>
· {item}
</div>
))
)}
</div>
);
}

// ============================================================================
// CHAIN VIEW
// ============================================================================

function ChainView({ tick }) {
const [selectedTick, setSelectedTick] = useState(tick);
useEffect(() => { setSelectedTick(tick); }, [tick]);
const recentTicks = useMemo(() => Array.from({ length: 12 }, (_, i) => tick - i), [tick]);
const events = MOCK_TICK_EVENTS(selectedTick);

return (
<div style={{ padding: 20 }}>
<div className=“grid” style={{ gridTemplateColumns: ‘1fr 2fr’, gap: 18 }}>
<Panel accent={T.navy}>
<BannerTitle subtitle="Click any tick to inspect">TICK CHRONICLE</BannerTitle>
<div style={{ display: ‘flex’, flexDirection: ‘column’, gap: 4, maxHeight: 480, overflowY: ‘auto’ }}>
{recentTicks.map(t => (
<button key={t} onClick={() => setSelectedTick(t)} style={{
display: ‘flex’, justifyContent: ‘space-between’, alignItems: ‘center’,
padding: ‘8px 12px’,
backgroundColor: selectedTick === t ? T.navy : T.parchment,
color: selectedTick === t ? T.goldLight : T.ink,
border: `1px solid ${selectedTick === t ? T.gold : T.paperLine}`,
cursor: ‘pointer’, fontFamily: FONT_MONO, fontSize: 12, textAlign: ‘left’,
}}>
<span style={{ fontWeight: 600 }}>TICK {t}</span>
<span style={{ fontSize: 10, opacity: 0.7 }}>{t === tick ? ‘LIVE’ : `${tick - t}t ago`}</span>
</button>
))}
</div>
</Panel>

```
    <Panel accent={T.navy}>
      <BannerTitle subtitle={`State transition for tick ${selectedTick}`}>TICK INSPECTOR</BannerTitle>
      <div className="grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 14 }}>
        <LabelValue label="SEED" value={`0x${(selectedTick * 0xa3f1).toString(16).slice(0, 6)}`} color={T.statusInfo} />
        <LabelValue label="HEARTBEAT TX" value={`0x${(selectedTick * 0x4a2f).toString(16).slice(0, 6)}…`} color={T.gold} />
        <LabelValue label="GAS USED" value={(180000 + selectedTick * 240).toLocaleString()} color={T.inkSoft} />
      </div>

      <DividerOrnament />
      <div style={{ height: 10 }} />

      <div style={{ fontFamily: FONT_DISPLAY, fontSize: 10, letterSpacing: '0.16em', color: T.inkMute, marginBottom: 8 }}>
        EVENTS DURING THIS TICK
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {events.map((e, i) => {
          const evColor = e.kind === 'BANDIT' || e.kind === 'STARVATION' ? T.statusDanger
                        : e.kind === 'TRADE' ? T.gold
                        : e.kind === 'MISSION' ? T.alpha
                        : e.kind === 'AXL' ? T.statusInfo
                        : T.inkSoft;
          return (
            <div key={i} className="flex items-start" style={{ gap: 10 }}>
              <span style={{
                fontFamily: FONT_DISPLAY, fontSize: 9, letterSpacing: '0.14em', fontWeight: 700,
                color: evColor, minWidth: 100, padding: '2px 6px',
                border: `1px solid ${evColor}`, backgroundColor: T.parchment, textAlign: 'center',
              }}>{e.kind}</span>
              <span style={{ fontFamily: FONT_BODY, fontSize: 13, color: T.ink, fontStyle: 'italic', flex: 1, lineHeight: 1.4 }}>
                {e.text}
              </span>
            </div>
          );
        })}
      </div>
    </Panel>
  </div>

  <div style={{ height: 18 }} />

  <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 18 }}>
    <Panel accent={T.gold}>
      <BannerTitle accent={T.gold} subtitle="Cumulative season totals">CHAIN ALMANAC</BannerTitle>
      <div className="grid" style={{ gridTemplateColumns: 'repeat(2, 1fr)', gap: 14 }}>
        <LabelValue label="TOTAL TX" value="2,847" color={T.gold} />
        <LabelValue label="GAS SPENT" value="312.4M" color={T.statusInfo} />
        <LabelValue label="HEARTBEATS" value={tick} color={T.alpha} />
        <LabelValue label="MISSIONS COMPLETED" value="412" color={T.statusGood} />
        <LabelValue label="UNISWAP SWAPS" value="89" color={T.delta} />
        <LabelValue label="OTC TRANSFERS" value="34" color={T.gamma} />
        <LabelValue label="BANDIT EVENTS" value="7" color={T.statusDanger} />
        <LabelValue label="DEATHS" value="0" color={T.inkMute} />
      </div>
    </Panel>

    <Panel accent={T.alpha}>
      <BannerTitle accent={T.alpha} subtitle="Live invariant checks">CONTRACT INVARIANTS</BannerTitle>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
        {[
          ['Resource conservation', true],
          ['Heartbeat continuity', true],
          ['Vault ≥ 0', true],
          ['Mission cooldowns enforced', true],
          ['Bandit max 1 troop', true],
          ['Pool k constant (Wood)', true],
          ['Pool k constant (Wheat)', true],
          ['Pool k constant (Fish)', true],
          ['Pool k constant (Iron)', true],
          ['Settlement determinism', true],
        ].map(([name, ok]) => (
          <div key={name} className="flex items-center justify-between" style={{
            padding: '6px 10px',
            backgroundColor: T.parchment,
            borderLeft: `3px solid ${ok ? T.statusGood : T.statusDanger}`,
          }}>
            <span style={{ fontFamily: FONT_BODY, fontSize: 12, color: T.ink, fontStyle: 'italic' }}>{name}</span>
            <span style={{
              fontFamily: FONT_DISPLAY, fontSize: 9, letterSpacing: '0.14em', fontWeight: 700,
              color: ok ? T.statusGood : T.statusDanger,
            }}>{ok ? '✓ HOLDS' : '✗ BROKEN'}</span>
          </div>
        ))}
      </div>
    </Panel>
  </div>
</div>
```

);
}

// ============================================================================
// MAIN
// ============================================================================

export default function ClanWorldCockpit() {
const { tick, paused, setPaused, secondsToNext } = useGameClock(188, 4000);
const [activeTab, setActiveTab] = useState(‘world’);
const [director, setDirector] = useState(false);

const renderTab = () => {
switch (activeTab) {
case ‘world’:     return <WorldView tick={tick} />;
case ‘market’:    return <MarketView tick={tick} />;
case ‘diplomacy’: return <DiplomacyView tick={tick} />;
case ‘cognition’: return <CognitionView />;
case ‘chain’:     return <ChainView tick={tick} />;
default:          return null;
}
};

return (
<div style={{
minHeight: ‘100vh’,
backgroundColor: T.parchment,
color: T.ink,
fontFamily: FONT_BODY,
backgroundImage: `radial-gradient(ellipse at top left, rgba(212, 168, 71, 0.08), transparent 60%), radial-gradient(ellipse at bottom right, rgba(31, 45, 74, 0.06), transparent 60%), repeating-linear-gradient(0deg, rgba(139, 119, 88, 0.02) 0px, rgba(139, 119, 88, 0.02) 1px, transparent 1px, transparent 3px), repeating-linear-gradient(90deg, rgba(139, 119, 88, 0.02) 0px, rgba(139, 119, 88, 0.02) 1px, transparent 1px, transparent 3px)`,
}}>
<style>{`
@import url(‘https://fonts.googleapis.com/css2?family=Cinzel:wght@500;600;700&family=EB+Garamond:ital,wght@0,400;0,500;0,600;0,700;1,400;1,500;1,600&family=IBM+Plex+Mono:wght@400;500;600&display=swap’);

```
    @keyframes softPulse {
      0%, 100% { opacity: 1; }
      50%      { opacity: 0.65; }
    }
    @keyframes tickerScroll {
      0%   { transform: translateX(0); }
      100% { transform: translateX(-50%); }
    }
    @keyframes broadcastRing {
      0%   { r: 8;  opacity: 0.7; }
      100% { r: 80; opacity: 0; }
    }

    .recharts-cartesian-axis-tick-value,
    .recharts-text {
      font-family: 'IBM Plex Mono', monospace !important;
      font-size: 10px !important;
    }

    *::-webkit-scrollbar { width: 8px; height: 8px; }
    *::-webkit-scrollbar-track { background: ${T.parchmentDeep}; }
    *::-webkit-scrollbar-thumb { background: ${T.inkMute}; border-radius: 0; }
    *::-webkit-scrollbar-thumb:hover { background: ${T.inkSoft}; }
  `}</style>

  <Header
    tick={tick}
    secondsToNext={secondsToNext}
    paused={paused}
    setPaused={setPaused}
    director={director}
    setDirector={setDirector}
  />
  <AlertsTicker />
  <TabNav active={activeTab} setActive={setActiveTab} />
  {renderTab()}

  <div style={{
    padding: '20px 24px',
    borderTop: `1px solid ${T.paperLine}`,
    backgroundColor: T.parchmentLight,
    textAlign: 'center',
  }}>
    <DividerOrnament />
    <div style={{
      fontFamily: FONT_BODY, fontStyle: 'italic',
      fontSize: 12, color: T.inkMute, marginTop: 10,
    }}>
      ClanWorld · A realm of four houses · Built upon 0G · Gensyn · KeeperHub · Uniswap
    </div>
  </div>
</div>
```

);
}
