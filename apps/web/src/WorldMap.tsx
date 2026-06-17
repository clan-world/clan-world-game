import { useEffect, useMemo, useRef, useState } from 'react';
import { useSafeQuery as useQuery } from './hooks/useSafeQuery';
import { useCachedSnapshot } from './hooks/useCachedSnapshot';
import { VIEWPORT_STORAGE_KEY } from './hooks/snapshotCacheConstants';
import { Application, Assets, BlurFilter, ColorMatrixFilter, Container, Graphics, Rectangle, Sprite, Text } from 'pixi.js';
import { Viewport } from 'pixi-viewport';
import { useAgentLogs, type AgentLog } from './useAgentLogs';
import { WorldNoticePanel } from './WorldNoticePanel';
import { TopHud } from './TopHud';
import { EventTicker } from './EventTicker';
import { MapGhostLayer } from './components/MapGhostLayer';
import { VersionBadge } from './components/cockpit/VersionBadge';
import { MAP_WIDTH, MAP_HEIGHT, LIVE_CLAN_REGION_BY_ID } from './components/mapGeometry';
import { api } from '../../server/convex/_generated/api';
import type { Doc } from '../../server/convex/_generated/dataModel';
import worldMapBg from './assets/world-map.png';
import worldMapWinterBg from './assets/world-map-winter.png';
import { DEMO_MODE, CAPTURE_MODE } from './config/env';
import { BanditState, ClansmanState } from '@clan-world/shared/generated/enums';
import { createWinterSnow, type WinterSnowHandle } from './effects/winterSnow';
import {
  type ClansmanAnimState,
  WALK_EPSILON_PX,
  WALK_FRAME_MS,
  directionForVector,
  framesForDirection,
  getClansmanFrameSet,
  hasClansmanSpriteSheet,
  loadClansmanSpriteSheet,
  makeClansmanAnimState,
} from './effects/clansmanSpriteSheet';

// World dimensions used by pixi-viewport for pan/clamp/center math.
// Matches the actual hand-curated bg PNG (apps/web/src/assets/world-map.png)
// at native resolution. The viewport scales/pans this world inside the screen.
// Re-exported from mapGeometry below (pure-data shared module).
const WORLD_WIDTH = MAP_WIDTH;
const WORLD_HEIGHT = MAP_HEIGHT;

// Debug overlay: render REGIONS[*].polygon as a colored fill + stroke so the
// hand-tuned region polygons are visible against the new map background. Lets
// us iterate the polygon coords visually with the map in view. Gated to
// `pnpm dev` only via `import.meta.env.DEV` so production builds never ship
// the debug fills + raw (x,y) vertex labels, while keeping the tooling on
// for future region authoring / map redesigns.
// Off under CAPTURE_MODE so the authored hero video never shows the debug
// polygon fills / raw (x,y) vertex labels even when captured against a dev build.
const SHOW_REGION_POLYGONS = import.meta.env.DEV && !CAPTURE_MODE;

// Winter map-overlay fade timings. The base map (`world-map.png`) stays fully
// opaque at all times; we modulate the alpha of a second Sprite
// (`world-map-winter.png`) layered immediately above it so the ground reads as
// snow-covered while `snapshot.winterActive` is true.
//
// Wall-clock fades — chosen to feel cinematic at the demo's 1s tick cadence
// without snapping. Spring thaw is intentionally slower than the freeze.
// These are intentionally NOT coupled to the heartbeat interval — if the
// on-chain tick rate changes, the fade still looks natural.
//
// Syncs with the existing snow particle effect (winterSnow.ts) via the same
// `winterActive` boolean — both kick off on the rising edge and unwind on the
// falling edge.
const WINTER_FADE_IN_MS = 1500;
const WINTER_FADE_OUT_MS = 2000;

// On first mount we look at the most recent BanditAttackResolved logs and
// only animate ones decoded within this window — older events are marked
// as already-seen so we don't replay history on a refresh.
const RECENT_BANDIT_EVENT_THRESHOLD_MS = 15_000;

interface RegionDef {
  id: string;
  name: string;
  // Native world-map coordinates. Keep these aligned to assets/world-map.png.
  nx: number;
  ny: number;
  polygon: Array<[number, number]>;
  color: number;
}

interface ClanDef {
  id: string;
  /**
   * Visual asset ID used to look up sprite-sheet PNG, base sprites, etc.
   * In DEMO_MODE this is identical to `id` (both come from MOCK_CLANS). In
   * live mode, `id` is the on-chain clan ID (e.g. "1", "2") and
   * `spriteSheetId` is the visual asset ID assigned via LIVE_CLAN_META
   * (e.g. "clan-iron", "clan-ember"). Separating the two keeps the chain
   * ID stable for focus/selection while sprite-sheet lookups
   * (hasClansmanSpriteSheet / loadClansmanSpriteSheet) hit the correct
   * SHEET_PATH_BY_CLAN entry. Without this, live-mode clans silently
   * skipped the animated walk sheet (super-swarm v2.6.0 HIGH from codex 5.5).
   */
  spriteSheetId: string;
  name: string;
  homeRegion: string;
  color: number;
  sigil: string;
  /** Portrait avatar shown in the HTML scoreboard overlay (style/bandit-archetype-sprites). */
  portrait: string;
  /** Archetype label rendered under the clan name in the scoreboard. */
  archetype: string;
  /** Base sprite (longhouse / tower / dock keep) shown at the home region. */
  basePng: string;
  /** Clansman worker sprite shown for traveling units (replaces colored dot). */
  clansmanPng: string;
  level?: number;
}

type WorldSnapshotClan = Doc<'worldSnapshot'>['clans'][number];
type SnapshotClan = Pick<
  WorldSnapshotClan,
  | 'id'
  | 'name'
  | 'treasury'
  | 'goldBalance'
  | 'blueprintBalance'
  | 'vaultWood'
  | 'vaultIron'
  | 'vaultWheat'
  | 'vaultFish'
  | 'baseRegion'
  | 'baseLevel'
  | 'wallLevel'
  | 'monumentLevel'
  | 'livingClansmen'
  | 'owner'
  | 'clansmen'
>;

type BanditViewDoc = Doc<'banditView'>;
type SnapshotBandit = Pick<
  BanditViewDoc,
  | 'id'
  | 'region'
  | 'state'
  | 'tier'
  | 'attackPower'
  | 'stateEnteredTick'
  | 'nextActionTick'
  | 'projectedTargetClanId'
>;

type ChainEvent = Doc<'chainEvents'>;

type LiveClansmanMarker = {
  key: string;
  clanId: string;
  /**
   * Visual asset ID used for sprite-sheet lookup
   * (getClansmanFrameSet / hasClansmanSpriteSheet). Mirrors ClanDef.spriteSheetId.
   * In DEMO_MODE equals clanId; in live mode clanId is the chain ID
   * (e.g. "1", "2") and spriteSheetId is the resolved visual asset ID
   * (e.g. "clan-iron", "clan-ember"). Carrying both avoids per-frame Map
   * lookups against the visual-clans list inside the position-update loop.
   */
  spriteSheetId: string;
  clansmanId: string;
  regionKey: string;
  targetRegionKey?: string;
  missionActive: boolean;
  action: number;
  startTick: number;
  arrivalTick: number;
  actionStartTick: number;
  settlesAtTick: number;
  carryWood: number;
  carryIron: number;
  carryWheat: number;
  carryFish: number;
  offsetIndex: number;
  color: number;
  /**
   * True when the chain reports ClansmanState.DEAD (enum=3). Dead clansmen
   * stay visible at their last region (no hide), but the body sprite rotates
   * 90° (lying down) and darkens via tint so the world map state matches the
   * cockpit "DEAD" badge instead of continuing to render an idle/standing pose.
   */
  isDead: boolean;
  node: Container;
  /** Direct ref to the body sprite (or Graphics fallback) so we can rotate / tint it without rotating the carry indicator + status badge. */
  body: Sprite | Graphics | null;
  /** Halo Graphics drawn for active-mission markers. Hidden when isDead. */
  halo: Graphics | null;
  carry: CarryIndicator;
  statusBg: Graphics;
  statusText: Text;
  route?: TravelRoute;
  /**
   * Per-marker animated-sprite state — direction, frame, last position, etc.
   * Populated when the clan's walk sheet has loaded and the body sprite was
   * built from a frame Texture (not from the legacy single-PNG fallback).
   * Null when the marker is still on the dot/legacy sprite path.
   *
   * Updated every tick from updateLiveClansmanPositions: we diff
   * (lastX, lastY) vs the new screen position to derive movement direction,
   * then advance `frame` by elapsed-ms / WALK_FRAME_MS when walking.
   * Dead clansmen freeze on whatever frame they were on; idle alive ones
   * snap to frame 0 of the held direction.
   */
  anim?: ClansmanAnimState;
};

// Reference design size — coords below are authored against the actual map art.
const REF_W = MAP_WIDTH;
const REF_H = MAP_HEIGHT;

// FIRST-PASS region polygons for 1086x1448 map. Strategy:
//   1. Scale old (814x1448) polygon coords by sx = 1086/814 ≈ 1.334 horizontally
//      only — the new map kept the same height (1448), it's just wider.
//   2. For forest / mountains / west-farms / east-farms, additionally widen the
//      INWARD-FACING edges by ±40 px so they read as visibly larger on the new
//      map (per Liam directive: those four regions want to be wider;
//      unicorn-town, docks, deep-sea keep scale-only sizing).
//   3. Region centers (nx/ny) are scaled-old-centers — they anchor the clan
//      zone halos and the region labels.
// Toggle SHOW_REGION_POLYGONS (above) to render the polygons as colored overlays
// for visual tuning, then iterate coords here.
const REGIONS: RegionDef[] = [
  {
    id: 'forest',
    name: 'Forest',
    nx: 280 / REF_W,
    ny: 245 / REF_H,
    color: 0x228822,
    polygon: [[0, 0], [573, 0], [523, 165], [475, 355], [330, 430], [185, 520], [10, 555]],
  },
  {
    id: 'mountains',
    name: 'Mountains',
    nx: 854 / REF_W,
    ny: 245 / REF_H,
    color: 0x888888,
    polygon: [[687, 0], [1086, 0], [1086, 535], [840, 555], [700, 420], [615, 270], [530, 190]],
  },
  {
    id: 'unicorn-town',
    name: 'Unicorn Town',
    nx: 482 / REF_W,
    ny: 500 / REF_H,
    color: 0xcc88cc,
    polygon: [[498, 395], [596, 395], [679, 453], [679, 543], [629, 585], [462, 585], [389, 520], [429, 421]],
  },
  {
    id: 'west-farms',
    name: 'West Farms',
    nx: 280 / REF_W,
    ny: 760 / REF_H,
    color: 0xaacc44,
    polygon: [[0, 595], [280, 550], [420, 600], [500, 700], [500, 880], [440, 960], [200, 940], [10, 840]],
  },
  {
    id: 'east-farms',
    name: 'East Farms',
    nx: 834 / REF_W,
    ny: 760 / REF_H,
    color: 0x88bb33,
    polygon: [[690, 580], [850, 625], [1086, 650], [1086, 905], [900, 970], [630, 970], [570, 925], [530, 750], [580, 670]],
  },
  {
    id: 'west-docks',
    name: 'West Docks',
    nx: 293 / REF_W,
    ny: 1115 / REF_H,
    color: 0x336688,
    polygon: [[155, 980], [400, 1030], [420, 1125], [390, 1160], [460, 1200], [430, 1270], [300, 1280], [150, 1270], [200, 1200], [145, 1150], [155, 1065], [100, 1040], [30, 935], [35, 890]],
  },
  {
    id: 'east-docks',
    name: 'East Docks',
    nx: 874 / REF_W,
    ny: 1115 / REF_H,
    color: 0x336688,
    polygon: [[720, 1020], [1010, 1010], [1060, 1035], [910, 1100], [980, 1170], [980, 1210], [880, 1300], [800, 1240], [680, 1280], [650, 1210], [670, 1130]],
  },
  {
    id: 'deep-sea',
    name: 'Deep Sea',
    nx: 540 / REF_W,
    ny: 1095 / REF_H,
    color: 0x1144aa,
    polygon: [[415, 1035], [587, 1015], [670, 1040], [645, 1130], [540, 1230], [480, 1130], [410, 1080]],
  },
];

// Halo / visual-area sizes (used for region focus / select rings). Scaled to
// the new 1086x1448 dimensions: rx ~ *1.334 (horizontal-only), ry unchanged,
// plus +20 rx for the four widened regions to match the polygon expansion.
const REGION_VISUAL_AREAS: Record<string, { rx: number; ry: number }> = {
  forest: { rx: 180, ry: 70 },
  mountains: { rx: 200, ry: 76 },
  'unicorn-town': { rx: 124, ry: 62 },
  'west-farms': { rx: 207, ry: 86 },
  'east-farms': { rx: 220, ry: 90 },
  'west-docks': { rx: 157, ry: 76 },
  'east-docks': { rx: 157, ry: 76 },
  'deep-sea': { rx: 240, ry: 90 },
};

// Clan ↔ archetype mapping (style/bandit-archetype-sprites): each clan gets a portrait
// avatar in the scoreboard so the AI personalities are visually distinguishable.
//   Iron Guard ↔ Aldric  (cautious accumulator)
//   Ember Hand ↔ Brennan (aggressive defender)
//   Dawn Watch ↔ Sora    (long-game monument-builder)
//   Storm Riders ↔ Mira  (transactional trader)
// Base sprite themes (one of 8 hand-painted clan keep sets shipped under /bases/):
//   cobalt-keep      — blue/grey castle w/ banners (knight)
//   bone-standard    — red barbarian camp w/ horns (warlord)
//   gilded-hold      — gold merchant stronghold
//   tide-wardens     — blue dock-on-water (fishers)
//   pale-cathedral   — cream stone cathedral (religious order)
//   amethyst-spire   — purple gothic w/ crystals (mystic)
//   black-forge      — dark stone forge w/ orange flames (smith)
//   verdant-grove    — green tree/treehouse castle (druid)
// The 4 active clans are mapped to themes whose colour palette matches their sigil.
const MOCK_CLANS: ClanDef[] = [
  { id: 'clan-iron',  spriteSheetId: 'clan-iron',  name: 'Iron Guard',   homeRegion: 'forest',     color: 0x4488cc, sigil: '/sigils/iron-guard-sigil.png',  portrait: '/portraits/aldric-portrait.png',  archetype: 'Cautious',   basePng: '/bases/cobalt-keep.png',   clansmanPng: '/clansmen/clan-iron.png'  },
  { id: 'clan-ember', spriteSheetId: 'clan-ember', name: 'Ember Hand',   homeRegion: 'mountains',  color: 0xcc4422, sigil: '/sigils/ember-hand-sigil.png',  portrait: '/portraits/brennan-portrait.png', archetype: 'Aggressive', basePng: '/bases/bone-standard.png', clansmanPng: '/clansmen/clan-ember.png' },
  { id: 'clan-dawn',  spriteSheetId: 'clan-dawn',  name: 'Dawn Watch',   homeRegion: 'west-farms', color: 0xccaa22, sigil: '/sigils/dawn-watch-sigil.png',  portrait: '/portraits/sora-portrait.png',    archetype: 'Builder',    basePng: '/bases/gilded-hold.png',   clansmanPng: '/clansmen/clan-dawn.png'  },
  { id: 'clan-storm', spriteSheetId: 'clan-storm', name: 'Storm Riders', homeRegion: 'east-farms', color: 0x44aacc, sigil: '/sigils/storm-riders-sigil.png', portrait: '/portraits/mira-portrait.png',   archetype: 'Trader',     basePng: '/bases/tide-wardens.png',  clansmanPng: '/clansmen/clan-storm.png' },
];

// LIVE_CLAN_REGION_BY_ID is imported from ./components/mapGeometry — shared with MapGhostLayer.

function clansmanPngForClanId(clanId: string): string | null {
  return MOCK_CLANS.find((clan) => clan.id === clanId)?.clansmanPng ?? null;
}

const REGION_KEY_BY_CHAIN_ID: Record<number, string> = {
  1: 'forest',
  2: 'mountains',
  3: 'unicorn-town',
  4: 'west-farms',
  5: 'east-farms',
  6: 'west-docks',
  7: 'east-docks',
  8: 'deep-sea',
};

function recordAt(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? value as Record<string, unknown> : null;
}

function fieldAt(value: unknown, key: string): unknown {
  return recordAt(value)?.[key];
}

function numberLike(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'string' && value.length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function eventKey(ev: ChainEvent): string {
  if (ev._id) return ev._id;
  if (ev.txHash && typeof ev.logIndex === 'number') return `${ev.txHash}:${ev.logIndex}`;
  return `${ev.eventName}:${ev.blockNumber ?? 0}:${ev.logIndex ?? 0}:${ev.tick ?? 0}`;
}

function resourceUnits(value: unknown): number {
  if (typeof value === 'bigint') return Number(value / BigInt(WEI_PER_RESOURCE));
  if (typeof value === 'string' && value.length > 0) {
    try {
      return Number(BigInt(value) / BigInt(WEI_PER_RESOURCE));
    } catch {
      return numberLike(value);
    }
  }
  return numberLike(value);
}

function actionVerb(action: number): string {
  if (action === 1) return 'chopping wood';
  if (action === 2) return 'mining iron';
  if (action === 3 || action === 4) return 'fishing';
  if (action === 5) return 'harvesting wheat';
  if (action === 6) return 'depositing';
  if (action === 7) return 'building wall';
  if (action === 8) return 'upgrading base';
  if (action === 9) return 'upgrading monument';
  if (action === 10) return 'defending base';
  if (action === 11) return 'buying market';
  if (action === 12) return 'selling market';
  if (action === 13) return 'waiting';
  if (action === 14) return 'withdrawing';
  return 'working';
}

function regionDisplayName(regionKey: string | undefined): string {
  return REGIONS.find((region) => region.id === regionKey)?.name ?? 'region';
}

function hashUnit(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10000) / 10000;
}

function lerpPoint(a: Point2, b: Point2, t: number): Point2 {
  return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) };
}

function cubicBezierPoint(p0: Point2, p1: Point2, p2: Point2, p3: Point2, t: number): Point2 {
  const u = 1 - t;
  const tt = t * t;
  const uu = u * u;
  const uuu = uu * u;
  const ttt = tt * t;
  return {
    x: uuu * p0.x + 3 * uu * t * p1.x + 3 * u * tt * p2.x + ttt * p3.x,
    y: uuu * p0.y + 3 * uu * t * p1.y + 3 * u * tt * p2.y + ttt * p3.y,
  };
}

function pointInPolygon(x: number, y: number, polygon: Array<[number, number]>) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const pi = polygon[i];
    const pj = polygon[j];
    if (!pi || !pj) continue;
    const intersects =
      (pi[1] > y) !== (pj[1] > y)
      && x < ((pj[0] - pi[0]) * (y - pi[1])) / (pj[1] - pi[1]) + pi[0];
    if (intersects) inside = !inside;
  }
  return inside;
}

function polygonWanderPoint(region: RegionDef, marker: LiveClansmanMarker, phase: number) {
  if (region.polygon.length < 3) return null;
  const xs = region.polygon.map(([x]) => x);
  const ys = region.polygon.map(([, y]) => y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  for (let i = 0; i < 16; i++) {
    const x = minX + hashUnit(`${marker.clanId}:${marker.clansmanId}:${region.id}:${phase}:x:${i}`) * (maxX - minX);
    const y = minY + hashUnit(`${marker.clanId}:${marker.clansmanId}:${region.id}:${phase}:y:${i}`) * (maxY - minY);
    if (pointInPolygon(x, y, region.polygon)) return { x, y };
  }
  return { x: region.nx * REF_W, y: region.ny * REF_H };
}

const LIVE_CLAN_META = [
  MOCK_CLANS[0]!,
  MOCK_CLANS[1]!,
  MOCK_CLANS[2]!,
  MOCK_CLANS[3]!,
  {
    ...MOCK_CLANS[0]!,
    id: 'clan-deployer',
    name: 'Deployer Keep',
    archetype: 'Manual',
    color: 0x9bd36a,
  },
] as const satisfies readonly ClanDef[];

function liveClansToVisualClans(live: readonly SnapshotClan[] | undefined): ClanDef[] {
  if (!live || live.length === 0) return [];
  return live
    .map((clan, index) => {
      const numericId = Number(clan.id);
      const meta = LIVE_CLAN_META[index % LIVE_CLAN_META.length] ?? MOCK_CLANS[index % MOCK_CLANS.length]!;
      const genericName = new RegExp(`^Clan\\s+${clan.id}$`, 'i').test(clan.name);
      const homeRegion = LIVE_CLAN_REGION_BY_ID[clan.baseRegion ?? 0] ?? meta.homeRegion;
      return {
        ...meta,
        id: clan.id,
        // Preserve the visual asset ID from the matched LIVE_CLAN_META entry —
        // overriding `id` with the chain ID would otherwise clobber it via
        // the spread, breaking sprite-sheet lookups in
        // hasClansmanSpriteSheet / loadClansmanSpriteSheet which key on the
        // visual asset ID (clan-iron, clan-ember, etc).
        spriteSheetId: meta.spriteSheetId,
        name: genericName ? meta.name : clan.name,
        homeRegion,
        level: clan.baseLevel ?? clan.monumentLevel ?? 1,
        archetype: Number.isFinite(numericId) && numericId === 5 ? 'Manual' : meta.archetype,
      };
    });
}

function levelBasePng(basePng: string, level: number | undefined): string {
  const clamped = Math.max(1, Math.min(5, Math.floor(level ?? 1)));
  return basePng.replace(/(?:-lv[1-5])?\.png$/, `-lv${clamped}.png`);
}

function baseVisualScale(level: number | undefined): number {
  const clamped = Math.max(1, Math.min(5, Math.floor(level ?? 1)));
  if (clamped <= 2) return 0.675;
  if (clamped <= 4) return 0.81;
  return 0.9;
}

// Worker sprite textures, loaded once at init. Keyed by clan id.
// Falls back to colored Graphics dot if texture missing.
const clansmanTextureCache: Record<string, import('pixi.js').Texture | undefined> = {};
const clansmanTexturePromiseCache: Record<string, Promise<import('pixi.js').Texture> | undefined> = {};

function loadClansmanTexture(clanId: string, clansmanPng: string) {
  if (clansmanTextureCache[clanId]) return Promise.resolve(clansmanTextureCache[clanId]!);
  if (clansmanTexturePromiseCache[clanId]) return clansmanTexturePromiseCache[clanId]!;
  clansmanTexturePromiseCache[clanId] = Assets.load(clansmanPng)
    .then((texture) => {
      clansmanTextureCache[clanId] = texture;
      return texture;
    })
    .catch((err) => {
      clansmanTexturePromiseCache[clanId] = undefined;
      throw err;
    });
  return clansmanTexturePromiseCache[clanId]!;
}

const SIGIL_SIZE = 36;

// Bubble visual + animation constants (PR #43)
const BUBBLE_MAX_WIDTH = 200;
const BUBBLE_PAD_X = 10;
const BUBBLE_PAD_Y = 8;
const BUBBLE_CORNER = 8;
const BUBBLE_FILL = 0x000000;
const BUBBLE_FILL_ALPHA = 0.72;
const BUBBLE_STACK_GAP = 6;
const BUBBLE_FLAG_OFFSET_Y = 6; // gap between sigil top and bubble tail tip
const FADE_IN_MS = 300;
const HOLD_MS = 4500;
const FADE_OUT_MS = 500;
const MAX_BUBBLES_PER_CLAN = 3;

// Tail visual constants — tuned for high contrast against dark/textured background.
const BUBBLE_TAIL_HEIGHT = 14;       // Tall enough to read as a pointer, not a chin.
const BUBBLE_TAIL_HALF_WIDTH = 7;    // Wide-ish base on the bubble side.
const BUBBLE_TAIL_OUTLINE = 0xffffff;
const BUBBLE_TAIL_OUTLINE_WIDTH = 2;

type BubbleHandle = {
  container: Container;
  bornAt: number;
  lifeMs: number;
  height: number; // backdrop + tail; used for vertical stacking
  clanId: string;
  tail: Graphics; // separate from backdrop so we can hide it on stacked (non-bottom) bubbles
};

type WorldLayers = {
  worldContainer: Container;
  terrainBackground: Container;
  terrainAccents: Container;
  worldDynamic: Container;
  inWorldEffects: Container;
  selectionRings: Container;
  bubbleLayer: Container;
  screenEffects: Container;
  combatDim: Graphics;
  combatHighlight: Container;
  combatFlash: Graphics;
};

type CarryIndicator = {
  container: Container;
  bg: Graphics;
  fill: Graphics;
  label: Text;
  displayedFill: number;
  targetFill: number;
};

type DayNightKeyframe = {
  r: number;
  g: number;
  b: number;
  brightness: number;
  sat: number;
};

type SelectableTarget = Container & {
  width: number;
  height: number;
};

type Point2 = { x: number; y: number };

type TravelRoute = {
  fromRegionKey: string;
  toRegionKey: string;
  startedAt: number;
  durationMs: number;
  seed: string;
  color: number;
  line: Graphics;
  clearing?: boolean;
  reconcile?: {
    startedAt: number;
    durationMs: number;
    from: Point2;
    to: Point2;
  };
};

// Worker travel animation (PR #44) — small clan-colored dots crossing between regions.
interface WorkerTravel {
  id: string;
  clanId?: string;
  fromRegionKey: string;
  toRegionKey: string;
  startedAt: number;
  durationMs: number;
  color: number;
  /** Display node — Sprite when clansman texture loaded, Graphics dot fallback. */
  gfx: Container;
  carry: CarryIndicator;
  route: TravelRoute;
}

type CombatOutcome = 'success' | 'failure';

type BurstParticle = {
  gfx: Graphics;
  vx: number;
  vy: number;
  life: number;
  decayRate: number;
};

type ReparentedCombatant = {
  node: Container;
  parent: Container;
  zIndex: number;
  wasTemporary?: boolean;
};

type CombatVignette = {
  startedAt: number;
  outcome: CombatOutcome;
  liveMode: boolean;
  bandit: Container | null;
  targetBase: Container;
  defenders: Container[];
  warningRing: Graphics;
  targetPulse: Graphics;
  marchLine: Graphics;
  aftermath: Graphics;
  warningText: Text;
  reparented: ReparentedCombatant[];
  baseStart: { x: number; y: number; scaleX: number; scaleY: number };
  banditStart: { x: number; y: number; scaleX: number; scaleY: number; alpha: number };
  defenderStarts: { x: number; y: number }[];
  center: { x: number; y: number };
};

type CombatTrigger = {
  outcome: CombatOutcome;
  targetClanId?: string;
  regionKey?: string;
  playKey: string;
  liveMode: boolean;
};

// ---- Bandit attack animation (docs/planning/bandit-animation-impl-plan.md)
// Phase machine derives current animation from the live snapshot + a snapshot-diff
// "lastOutcome" memo. T3 last 10s = telegraph. T4 = full battle / advance / escape.

type BanditDiffOutcome =
  | { type: 'defeated'; resolvedTick: number; fromRegion: number; targetClanId: string | null }
  | { type: 'won'; resolvedTick: number; fromRegion: number; toRegion: number; targetClanId: string | null }
  | { type: 'no_battle_advance'; resolvedTick: number; fromRegion: number; toRegion: number };

type BanditAnimPhase =
  | { kind: 'hidden' }
  | { kind: 'camp_idle'; regionKey: string; glowAlpha: number }
  | { kind: 'camp_telegraph'; regionKey: string; telegraphProgress: number }
  | { kind: 'battle'; regionKey: string; targetClanId: string | null; outcome: BanditDiffOutcome; battleT: number }
  | { kind: 'no_battle_advance'; fromRegionKey: string; toRegionKey: string; traversalT: number };

// 8 FPS frame indexer for 4-frame walk cycles.
const BANDIT_WALK_FRAME_MS = 1000 / 8;

// Telegraph window: last ~17% of the 3-tick camp (≈10s of a 60s tick).
const TELEGRAPH_PROGRESS_THRESHOLD = 2.83;
const TELEGRAPH_DURATION_TICKS = 0.17;

// Battle phase sub-windows (fractions of a 60s tick = battleT 0..1).
const BATTLE_T_MARCH_END = 7 / 60;        // 0..7s march
const BATTLE_T_CIRCLE_END = 14.5 / 60;    // 7..14.5s circle
const BATTLE_T_FLASH_END = 15.5 / 60;     // 14.5..15.5s flash + launch
const BATTLE_T_DEATH_END = 17.5 / 60;     // 15.5..17.5s death frames (defeat path)
const BATTLE_T_FADE_END = 25.5 / 60;      // 17.5..25.5s tombstone fade (defeat) / cluster + walk (win)
const BATTLE_T_WIN_CLUSTER_END = 18.5 / 60; // 17..18.5s cluster pause (win)
const BATTLE_T_WIN_WALK_END = 25.5 / 60;  // 18.5..25.5s walk to next region (win)

const BANDIT_SPRITE_SCALE = 0.12; // 384x512 (SE) → ~46x61 at scale 0.12, close to clansman
const BANDIT_SPRITE_DEATH_SCALE = 0.10;

const TRAVEL_DOT_RADIUS = 4; // 8px diameter — slightly bigger so it reads in the demo
const TRAVEL_FADE_OUT_MS = 1200; // longer linger at destination
const TRAVEL_DEST_LINGER_MS = 2500; // hold at destination at full alpha before fading
const OPTIMISTIC_TRAVEL_MS = 60_000;
const TRAVEL_RECONCILE_MS = 450;
const MAX_DECORATIVE_TRAVELS = 8;
const CANNED_TRAVEL_INTERVAL_MS = 4500; // long 60s paths need a quieter spawn cadence

const COMBAT_VIGNETTE_LEAD_MS = 10_200;
const COMBAT_WARNING_MS = 1200;
const COMBAT_ADVANCE_MS = 3600;
const COMBAT_STANDOFF_MS = 1000;
const COMBAT_FLASH_START_MS = COMBAT_WARNING_MS + COMBAT_ADVANCE_MS + COMBAT_STANDOFF_MS;
const COMBAT_FLASH_IN_MS = 80;
const COMBAT_FLASH_HOLD_MS = 100;
const COMBAT_FLASH_FADE_MS = 800;
const COMBAT_RESOLUTION_START_MS = COMBAT_FLASH_START_MS + 320;
const COMBAT_RESOLUTION_CAP_MS = 2600;
const COMBAT_AFTERMATH_MS = 1400;
const COMBAT_TOTAL_MS = COMBAT_RESOLUTION_START_MS + COMBAT_RESOLUTION_CAP_MS + COMBAT_AFTERMATH_MS;
const COMBAT_DIM_ALPHA = 0.55;
const COMBAT_DIM_TINT = 0x1a1a3a;
const COMBAT_TARGET_CLAN_ID = 'clan-ember';
/** Demo combat outcome — overrideable via URL param `?combat=success|failure`
 * for stage flexibility. Defaults to failure since wall-drop reads more
 * dramatic. Replace with `snapshot.combatOutcome` when schema lands. */
function readDemoCombatOutcome(): CombatOutcome {
  if (typeof window === 'undefined') return 'failure';
  const param = new URLSearchParams(window.location.search).get('combat');
  return param === 'success' ? 'success' : 'failure';
}

const WEI_PER_RESOURCE = 1_000_000_000_000_000_000;
const WOOD_CAP = 15;
const IRON_CAP = 10;
const WHEAT_CAP = 10;
const FISH_CAP = 10;
const CARRY_BAR_W = 46;
const CARRY_BAR_H = 5;

const TICKS_PER_DAY_CYCLE = 30;
const FALLBACK_DAY_TICK_MS = 60_000;
// Disabled in normal demo/live mode; re-enabled under CAPTURE_MODE so the
// authored hero video gets the cinematic dawn→day→dusk→night lighting sweep.
const ENABLE_DAY_NIGHT_EFFECT = CAPTURE_MODE;
const DAYNIGHT_KEYFRAMES: Record<'dawn' | 'day' | 'dusk' | 'night', DayNightKeyframe> = {
  dawn: { r: 1.10, g: 0.90, b: 0.80, brightness: 0.95, sat: 0.85 },
  day: { r: 1.00, g: 1.00, b: 1.00, brightness: 1.00, sat: 1.00 },
  dusk: { r: 1.15, g: 0.85, b: 0.70, brightness: 0.85, sat: 0.95 },
  night: { r: 0.65, g: 0.70, b: 0.95, brightness: 0.55, sat: 0.70 },
};
const DAYNIGHT_PHASES = [
  { at: 0.00, key: 'dawn' as const },
  { at: 0.05, key: 'day' as const },
  { at: 0.50, key: 'dusk' as const },
  { at: 0.55, key: 'night' as const },
  { at: 1.00, key: 'dawn' as const },
];

/** Map a log message to a clan id by string-matching id or name. */
function attributeClan(msg: string): string | null {
  const lower = msg.toLowerCase();
  for (const clan of MOCK_CLANS) {
    if (lower.includes(clan.id) || lower.includes(clan.name.toLowerCase())) {
      return clan.id;
    }
  }
  return null;
}

/** Match a free-form region reference ("Mountains", "east farms") → region id. */
function matchRegionId(text: string): string | null {
  const lower = text.toLowerCase();
  // Prefer longest names first so "east-farms" wins over "farms"
  const sorted = [...REGIONS].sort((a, b) => b.name.length - a.name.length);
  for (const r of sorted) {
    if (lower.includes(r.id) || lower.includes(r.name.toLowerCase())) {
      return r.id;
    }
  }
  return null;
}

/**
 * Parse a "send <clansman/anyone> to <region>" pattern out of a log message.
 * Returns the destination region id, or null if no match.
 * Examples that should match:
 *   "send Borin to the Mountains"
 *   "Iron Guard sends a worker to East Farms"
 *   "dispatching scout to deep-sea"
 */
function parseTravelDestination(msg: string): string | null {
  const lower = msg.toLowerCase();
  // Look for "send|sends|sent|dispatch|dispatched|dispatching ... to <region>"
  const re = /\b(?:send(?:s|ing|t)?|dispatch(?:es|ing|ed)?|travel(?:s|ing|ed)?\s+to|head(?:s|ing|ed)?\s+to|move(?:s|d|ing)?\s+to)\b[^]*?\bto\s+(?:the\s+)?([a-z\- ]+?)(?:[.!,;]|$)/i;
  const m = lower.match(re);
  if (m && m[1]) {
    const candidate = m[1].trim();
    const id = matchRegionId(candidate);
    if (id) return id;
  }
  // Looser fallback: any " to <region>" reference if msg also mentions send/dispatch
  if (/\b(send|sent|sends|dispatch|dispatched|dispatching|travel|heading|moves)\b/.test(lower)) {
    const m2 = lower.match(/\bto\s+(?:the\s+)?([a-z\- ]+?)(?:[.!,;]|$)/);
    if (m2 && m2[1]) {
      const id = matchRegionId(m2[1].trim());
      if (id) return id;
    }
  }
  return null;
}

// Hex color → CSS string for the React scoreboard overlay
const hex = (n: number) => '#' + n.toString(16).padStart(6, '0');

// Demo bandit state — once the Convex schema gains banditState + monumentLevel,
// pull these from the snapshot. For now hardcoded so the canvas shows the threat.
// TODO(server-schema): replace with snapshot.banditState when wired.
const DEMO_BANDIT = {
  regionId: 'mountains',
  state: 'CAMPING' as const,
  attacksAtTick: 48,
};

const BANDIT_ANIMATION_META = {
  fallbackAsset: '/sprites/bandit.png',
  states: {
    idle: { frames: 4, fps: 4, loop: true },
    march: { frames: 4, fps: 6, loop: true },
    attack: { frames: 4, fps: 8, loop: true },
    death: { frames: 6, fps: 8, loop: false },
  },
} as const;

// Mock wall levels, indexed by MOCK_CLANS position (0..3). Clan 2 (Dawn Watch)
// is bandit-damaged so its ring is faint. Replace with snapshot.walls[clanId]
// once schema is wired.
// TODO(server-schema): pull from snapshot.walls when wired.
const MOCK_WALL_LEVELS: Record<string, number> = {
  'clan-iron':  2,
  'clan-ember': 3,
  'clan-dawn':  1,
  'clan-storm': 4,
};
const WALL_LEVEL_MAX = 5;

// Monument visual constants
const MONUMENT_BASE_HEIGHT = 6;
const MONUMENT_LEVEL_HEIGHT = 8; // px per level
const MONUMENT_LEVEL_MAX = 10;
const MONUMENT_WIDTH = 8;

// Derive a "monument level" from treasury for demo display. Real schema will replace this.
function treasuryToMonument(treasury: string): number {
  try {
    const t = BigInt(treasury);
    // 250e18 per level — tuned so mock clans land at 4/3/2/1
    const level = Number(t / BigInt('250000000000000000000'));
    return Math.max(1, Math.min(level, 9));
  } catch {
    return 1;
  }
}

function createWorldLayers(): WorldLayers {
  const worldContainer = new Container();
  const terrainBackground = new Container();
  const terrainAccents = new Container();
  const worldDynamic = new Container();
  const inWorldEffects = new Container();
  const selectionRings = new Container();
  const bubbleLayer = new Container();
  const screenEffects = new Container();
  const combatDim = new Graphics();
  const combatHighlight = new Container();
  const combatFlash = new Graphics();
  worldDynamic.sortableChildren = true;
  // §14.3: combatHighlight must use insertion-order so the success-launch
  // (bandit drawn after defenders) doesn't sort under the targeted base.
  // No sortableChildren here. (claude r3 SHOULD #1)
  screenEffects.sortableChildren = true;
  combatDim.zIndex = 0;
  combatHighlight.zIndex = 1;
  combatFlash.zIndex = 2;
  combatDim.alpha = 0;
  combatFlash.alpha = 0;
  screenEffects.addChild(combatDim, combatHighlight, combatFlash);
  worldContainer.addChild(terrainBackground, terrainAccents, worldDynamic);
  return {
    worldContainer,
    terrainBackground,
    terrainAccents,
    worldDynamic,
    inWorldEffects,
    selectionRings,
    bubbleLayer,
    screenEffects,
    combatDim,
    combatHighlight,
    combatFlash,
  };
}

function makeCarryIndicator(): CarryIndicator {
  const container = new Container();
  container.alpha = 0;
  const bg = new Graphics();
  bg.rect(-CARRY_BAR_W / 2, -CARRY_BAR_H / 2, CARRY_BAR_W, CARRY_BAR_H);
  bg.fill({ color: 0x1a1612, alpha: 0.95 });
  bg.stroke({ color: 0x000000, width: 1, alpha: 0.85 });
  const fill = new Graphics();
  const label = new Text({
    text: '',
    style: {
      fill: 0xfff2c6,
      fontSize: 9,
      fontFamily: '"Inter", Arial, sans-serif',
      fontWeight: '800',
      stroke: { color: 0x11100c, width: 2 },
    },
  });
  label.anchor.set(0.5, 0.5);
  label.y = -9;
  container.addChild(bg);
  container.addChild(fill);
  container.addChild(label);
  return { container, bg, fill, label, displayedFill: 0, targetFill: 0 };
}

function setCarryTargetFromCarry(
  indicator: CarryIndicator,
  carry: { wood?: number; iron?: number; wheat?: number; fish?: number },
) {
  indicator.targetFill = Math.max(
    (carry.wood ?? 0) / WOOD_CAP,
    (carry.iron ?? 0) / IRON_CAP,
    (carry.wheat ?? 0) / WHEAT_CAP,
    (carry.fish ?? 0) / FISH_CAP,
  );
}

function redrawCarryIndicator(indicator: CarryIndicator) {
  const next = Math.max(0, Math.min(1, indicator.displayedFill));
  indicator.container.alpha = indicator.label.text || next > 0.01 ? 1 : 0;
  indicator.fill.clear();
  if (next <= 0.01) return;
  indicator.fill.rect(-CARRY_BAR_W / 2, -CARRY_BAR_H / 2, CARRY_BAR_W * next, CARRY_BAR_H);
  indicator.fill.fill({ color: 0xe8d8b5, alpha: 1 });
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function easeOutQuad(t: number) {
  return 1 - (1 - t) * (1 - t);
}

function easeInQuad(t: number) {
  return t * t;
}

function easeInOutQuad(t: number) {
  return t < 0.5 ? 2 * t * t : 1 - ((-2 * t + 2) ** 2) / 2;
}

// Pure: derive bandit animation phase from snapshot + diff outcome + currentTickFloat.
// See docs/planning/bandit-animation-impl-plan.md §"Animation phase from currentTickFloat".
export function computeBanditAnimPhase(
  bandit: SnapshotBandit | null,
  lastOutcome: BanditDiffOutcome | null,
  currentTickFloat: number,
  regionKeyByChainId: Record<number, string>,
): BanditAnimPhase {
  // T4 outcome animations win over the freshly updated live bandit row. Without
  // this priority, a won bandit immediately appears Camped in the destination
  // region and skips the battle / walk-out sequence.
  if (lastOutcome) {
    const battleT = currentTickFloat - lastOutcome.resolvedTick;
    if (battleT >= 0 && battleT < BATTLE_T_FADE_END) {
      if (lastOutcome.type === 'no_battle_advance') {
        const fromRegionKey = regionKeyByChainId[lastOutcome.fromRegion];
        const toRegionKey = regionKeyByChainId[lastOutcome.toRegion];
        if (!fromRegionKey || !toRegionKey) return { kind: 'hidden' };
        return {
          kind: 'no_battle_advance',
          fromRegionKey,
          toRegionKey,
          traversalT: clamp01(battleT / BATTLE_T_FADE_END),
        };
      }

      const fromRegionKey = regionKeyByChainId[lastOutcome.fromRegion];
      if (!fromRegionKey) return { kind: 'hidden' };
      // Both 'won' and 'defeated' outcomes now carry a targetClanId so the
      // attack-circle animation anchors to the actual rendered base sprite
      // instead of a stale fromAnchor offset (empty patch of map).
      const phaseTargetClanId =
        lastOutcome.type === 'won' || lastOutcome.type === 'defeated'
          ? lastOutcome.targetClanId
          : null;
      return {
        kind: 'battle',
        regionKey: fromRegionKey,
        targetClanId: phaseTargetClanId,
        outcome: lastOutcome,
        battleT,
      };
    }
  }

  // Active "live" bandit on chain.
  if (bandit) {
    const ticksInState = currentTickFloat - bandit.stateEnteredTick;
    const regionKey = regionKeyByChainId[bandit.region];
    if (!regionKey) return { kind: 'hidden' };

    if (bandit.state === BanditState.Camped) {
      if (ticksInState < TELEGRAPH_PROGRESS_THRESHOLD) {
        const glowAlpha = clamp01(ticksInState / 3);
        return { kind: 'camp_idle', regionKey, glowAlpha };
      }
      const tProg = clamp01((ticksInState - TELEGRAPH_PROGRESS_THRESHOLD) / TELEGRAPH_DURATION_TICKS);
      return { kind: 'camp_telegraph', regionKey, telegraphProgress: tProg };
    }

    if (bandit.state === BanditState.Spawned) {
      // Newly spawned: render as camp idle while glow fades in.
      const glowAlpha = clamp01(ticksInState);
      return { kind: 'camp_idle', regionKey, glowAlpha };
    }

    if (bandit.state === BanditState.Attacking) {
      // Should be transient; if a fresh outcome exists it was consumed by the
      // priority window above. Without one, hold the fully telegraphed camp.
      return { kind: 'camp_telegraph', regionKey, telegraphProgress: 1 };
    }

    if (bandit.state === BanditState.Defeated) {
      const battleT = currentTickFloat - bandit.stateEnteredTick;
      if (battleT < 0 || battleT >= BATTLE_T_FADE_END) return { kind: 'hidden' };
      const targetClanId = bandit.projectedTargetClanId > 0 ? String(bandit.projectedTargetClanId) : null;
      const outcome: BanditDiffOutcome = {
        type: 'defeated',
        resolvedTick: bandit.stateEnteredTick,
        fromRegion: bandit.region,
        targetClanId,
      };
      return {
        kind: 'battle',
        regionKey,
        targetClanId,
        outcome,
        battleT,
      };
    }
  }

  return { kind: 'hidden' };
}

function getDayNightFrame(progress01: number): DayNightKeyframe {
  const wrapped = ((progress01 % 1) + 1) % 1;
  for (let i = 0; i < DAYNIGHT_PHASES.length - 1; i++) {
    const a = DAYNIGHT_PHASES[i];
    const b = DAYNIGHT_PHASES[i + 1];
    if (!a || !b) continue;
    if (wrapped >= a.at && wrapped <= b.at) {
      const t = b.at === a.at ? 0 : (wrapped - a.at) / (b.at - a.at);
      const from = DAYNIGHT_KEYFRAMES[a.key];
      const to = DAYNIGHT_KEYFRAMES[b.key];
      return {
        r: lerp(from.r, to.r, t),
        g: lerp(from.g, to.g, t),
        b: lerp(from.b, to.b, t),
        brightness: lerp(from.brightness, to.brightness, t),
        sat: lerp(from.sat, to.sat, t),
      };
    }
  }
  return DAYNIGHT_KEYFRAMES.dawn;
}

function applyDayNightFilter(filter: ColorMatrixFilter, frame: DayNightKeyframe) {
  const r = frame.r * frame.brightness;
  const g = frame.g * frame.brightness;
  const b = frame.b * frame.brightness;
  void frame.sat;
  filter.matrix = [
    r, 0, 0, 0, 0,
    0, g, 0, 0, 0,
    0, 0, b, 0, 0,
    0, 0, 0, 1, 0,
  ];
}

function drawSelectionRing(g: Graphics, radius: number, color: number) {
  g.clear();
  const segmentCount = 8;
  const gap = 0.18;
  const step = (Math.PI * 2) / segmentCount;
  for (let i = 0; i < segmentCount; i++) {
    const start = i * step + gap;
    const end = (i + 1) * step - gap;
    const samples = 6;
    for (let j = 0; j <= samples; j++) {
      const a = lerp(start, end, j / samples);
      const x = Math.cos(a) * radius;
      const y = Math.sin(a) * radius * 0.45;
      if (j === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
  }
  g.stroke({ color, width: 2, alpha: 1 });
}

export function WorldMap() {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasWrapRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<Application | null>(null);
  // pixi-viewport instance — wraps all map layers so multi-touch pinch / drag /
  // wheel are handled at the application layer where browser-level pinch can be
  // unreliable.
  const viewportRef = useRef<Viewport | null>(null);
  const layoutRef = useRef<{ scale: number; scaleX: number; scaleY: number; offsetX: number; offsetY: number }>({
    scale: 1,
    scaleX: 1,
    scaleY: 1,
    offsetX: 0,
    offsetY: 0,
  });
  const drawnRef = useRef<{
    regions: Graphics[];
    regionLabels: Text[];
    /** Per-region debug polygon overlay (visible when SHOW_REGION_POLYGONS).
     *  Indexes align with REGIONS[]. Each is a Graphics on terrainBackground
     *  (above bg image, below clanZones/sprites). Cleared + redrawn per layout. */
    regionPolygons: Graphics[];
    /** Per-region per-vertex Text labels showing polygon coords (visible when
     *  SHOW_REGION_POLYGONS). Outer index aligns with REGIONS[], inner index
     *  aligns with REGIONS[i].polygon[v]. Used for polygon-tuning UAT. */
    regionVertexLabels: Text[][];
    /** Big translucent zone halos per CLAN at their home region (breathing, hackathon-visual). */
    clanZones: { gfx: Graphics; clan: ClanDef }[];
    /** Per-clan base sprite (96x96 PNG: tower / longhouse / dock keep). */
    bases: {
      container: Container;
      sprite: Sprite | null;
      fallback: Graphics;
      glow: Graphics;
      clan: ClanDef;
      baseY: number;
      phaseOffset: number;
      /** Natural scale.y captured at relayout (after sprite.height = baseSize).
       *  Breathing animation multiplies this — never assigns scale.y directly,
       *  which would clobber the height-fit ratio and stretch bases ~3x tall. */
      baseScaleY: number;
    }[];
    /** Floating "Lv N" badge beside each base. */
    levelBadges: { bg: Graphics; label: Text; clan: ClanDef }[];
    liveClansmen: LiveClansmanMarker[];
    flags: { gfx: Graphics; sprite: Sprite | null; label: Text; clan: ClanDef }[];
    walls: { gfx: Graphics; clan: ClanDef }[];
    monuments: { gfx: Graphics; clan: ClanDef }[];
    /** Procedural fallback ring drawn until the bandit sprite finishes loading. */
    banditIcon: Graphics | null;
    /** Loaded bandit silhouette sprite (96x96 RGBA). null until Assets.load resolves. */
    banditSprite: Sprite | null;
    banditCountdown: Text | null;
    bgSprite: Sprite | null;
  }>({
    regions: [],
    regionLabels: [],
    regionPolygons: [],
    regionVertexLabels: [],
    clanZones: [],
    bases: [],
    levelBadges: [],
    liveClansmen: [],
    flags: [],
    walls: [],
    monuments: [],
    banditIcon: null,
    banditSprite: null,
    banditCountdown: null,
    bgSprite: null,
  });
  const liveClanVisualKeyRef = useRef<string>('');
  const liveClansmanVisualKeyRef = useRef<string>('');

  const layersRef = useRef<WorldLayers | null>(null);
  const dayNightFilterRef = useRef<ColorMatrixFilter | null>(null);
  const dayNightTickerCbRef = useRef<(() => void) | null>(null);
  const selectedRef = useRef<{
    target: SelectableTarget;
    ring: Graphics;
    color: number;
  } | null>(null);
  const selectedClanIdRef = useRef<string | null>(null);
  const tickClockRef = useRef<{ tick: number; seenAtMs: number }>({ tick: 0, seenAtMs: Date.now() });
  // Snapshot ref populated below in a useEffect — declared up here so the
  // day/night ticker (registered once at Pixi mount) reads current
  // snapshot/tickEpoch instead of the stale closure capture.
  const snapshotRef = useRef<ReturnType<typeof useQuery<typeof api.getSnapshot.getSnapshot>> | undefined>(undefined);

  // Per-clan speech-bubble system (PR #43).
  const bubbleLayerRef = useRef<Container | null>(null);
  const bubblesByClanRef = useRef<Map<string, BubbleHandle[]>>(new Map());
  const seenLogIdsRef = useRef<Set<string>>(new Set());
  const flagAnchorsRef = useRef<Map<string, { x: number; y: number }>>(new Map());
  const tickerCbRef = useRef<((ticker: { deltaMS: number }) => void) | null>(null);

  // Worker travel animation (PR #44).
  const travelLayerRef = useRef<Container | null>(null);
  const travelsRef = useRef<WorkerTravel[]>([]);
  const travelTickerCbRef = useRef<((ticker: { deltaMS: number }) => void) | null>(null);
  const seenTravelLogIdsRef = useRef<Set<string>>(new Set());
  const travelIdSeqRef = useRef(0);
  const combatVignetteRef = useRef<CombatVignette | null>(null);
  // Set true after a `?combat=success` vignette completes, so the bandit
  // stays hidden post-fade-out instead of popping back to the home anchor.
  const banditDefeatedRef = useRef(false);
  const combatTickerCbRef = useRef<(() => void) | null>(null);
  const combatPlayedTickRef = useRef<number | null>(null);
  const pendingCombatTriggerRef = useRef<CombatTrigger | null>(null);
  const seenCombatEventKeysRef = useRef<Set<string>>(new Set());
  const combatEventsInitializedRef = useRef(false);
  const liveTickClockRef = useRef<{ tick: number; seenAtMs: number }>({ tick: 0, seenAtMs: Date.now() });
  const tickClockEpochRef = useRef<{ tick: number; startedAt: number; durationMs: number } | null>(null);
  const liveTickRef = useRef(0);

  // Zone-pulse ticker (visual heartbeat for clan zone halos).
  const zonePulseCbRef = useRef<(() => void) | null>(null);
  const isMountedRef = useRef(true);

  // Pixel-burst effect system.
  const burstParticlesRef = useRef<BurstParticle[]>([]);
  const burstTickerCbRef = useRef<(() => void) | null>(null);
  const seenBurstLogIdsRef = useRef<Set<string>>(new Set());

  // Winter snowfall overlay (screen-space particle layer above viewport, below
  // React DOM UI). Created post-init; activated/deactivated via setActive in a
  // separate effect that watches `snapshot.winterActive`.
  const winterSnowRef = useRef<WinterSnowHandle | null>(null);
  // Winter MAP overlay sprite — second Sprite layered in `terrainBackground`
  // immediately above the base map and below region polygons / clan zones /
  // clansmen. Its `alpha` is animated by a per-frame ticker callback based on
  // an `idle | fade-in | active | fade-out` state machine driven by
  // `snapshot.winterActive` edge detection. Sprite stays mounted across the
  // entire session — only alpha modulates — so we never re-allocate / re-bind
  // the (large 1086x1448) texture on season swaps.
  const winterSpriteRef = useRef<Sprite | null>(null);
  // Edge-detector for winterActive. `null` on first render so we don't
  // mis-trigger a fade-in if the world boots already in Winter.
  const prevWinterActiveRef = useRef<boolean | null>(null);
  // Alpha-envelope state machine. Drives `winterSpriteRef.current.alpha` from a
  // ticker callback so the animation runs in wall-clock time (not tied to
  // React renders or chain ticks). Mirrors the fade pattern used by
  // `createWinterSnow`'s internal phase machine — start-alpha is captured at
  // each transition so mid-fade reversals are seamless (no blink).
  const winterFadePhaseRef = useRef<'idle' | 'fade-in' | 'active' | 'fade-out'>('idle');
  const winterFadeStartMsRef = useRef(0);
  const winterFadeStartAlphaRef = useRef(0);
  const winterFadeTickerCbRef = useRef<(() => void) | null>(null);
  // prefers-reduced-motion media query + change listener. Sampled once at app
  // init and re-checked on any OS-level toggle (issue #250). Stored on refs so
  // the cleanup in the pixi-init useEffect can remove the listener without
  // re-running on every render.
  const reducedMotionMqRef = useRef<MediaQueryList | null>(null);
  const reducedMotionHandlerRef = useRef<((event: MediaQueryListEvent) => void) | null>(null);

  // Bandit attack animation (docs/planning/bandit-animation-impl-plan.md).
  // Snapshot-diff tracking: derive last resolution outcome on every snapshot tick.
  // Known cold-start gap: if the page reloads during the T4 resolution window,
  // prevBanditRef starts empty and we cannot reconstruct lastBanditOutcomeRef
  // from the current snapshot alone. Persist a compact lastResolution row in
  // Convex before attempting to replay mid-battle after reload.
  const prevBanditRef = useRef<SnapshotBandit | null>(null);
  const lastBanditOutcomeRef = useRef<BanditDiffOutcome | null>(null);
  const banditAnimRef = useRef<{
    campSprite: Sprite | null;
    campGlow: Graphics | null;
    walkers: Sprite[];
    deathSprites: Sprite[];
    /** Red-tinted, blurred sprite shadows layered BEHIND each walker.
     * Gives the bandit silhouette a glow halo against the map terrain
     * (standing / moving / attacking — all 3 states share the same walker
     * sprite, so one halo array covers them). */
    walkerGlows: Sprite[];
    /** Red-tinted, blurred sprite shadows layered BEHIND each death sprite. */
    deathGlows: Sprite[];
    walkTextures: { ne: import('pixi.js').Texture[]; se: import('pixi.js').Texture[] };
    deathTextures: import('pixi.js').Texture[];
    campTexture: import('pixi.js').Texture | null;
    assetsReady: boolean;
    isLoading: boolean;
  }>({
    campSprite: null,
    campGlow: null,
    walkers: [],
    deathSprites: [],
    walkerGlows: [],
    deathGlows: [],
    walkTextures: { ne: [], se: [] },
    deathTextures: [],
    campTexture: null,
    assetsReady: false,
    isLoading: false,
  });
  const banditAnimTickerCbRef = useRef<(() => void) | null>(null);

  const [pixiReady, setPixiReady] = useState(false);
  const [pixiInitError, setPixiInitError] = useState<Error | null>(null);
  const [webglLost, setWebglLost] = useState(false);
  const [, setSize] = useState({ w: 800, h: 600 });
  // Tracks the currently-selected clan base for the floating HUD readout.
  // Mirrors selectedRef when the selection target is a base; null otherwise.
  const [selectedClanId, setSelectedClanId] = useState<string | null>(null);

  const logs = useAgentLogs();
  const liveSnapshot = useQuery(api.getSnapshot.getSnapshot);
  // Lightweight tick-only subscription (~50 bytes/tick). Invalidates every tick
  // so WorldMap always has a fresh tick counter without pulling 40KB of world data.
  const tickClock = useQuery(api.getTickClock.getTickClock);
  // Cache the snapshot in localStorage so iOS Safari (and other browsers that
  // pause background tabs) can render the last-known world state instantly on
  // PWA return — instead of flashing the "no chain data yet" placeholder
  // while Convex's websocket reconnects.
  const snapshot = useCachedSnapshot(liveSnapshot);
  // Stable boolean: true only when the snapshot contains at least one deployed
  // clan. Used as the sole dep of the grace-period useEffect so we don't reset
  // the 5s timer on every heartbeat tick (snapshot object changes every tick).
  const hasClans = !!snapshot?.clans && snapshot.clans.length > 0;
  // Grace period before showing the "no chain data yet" placeholder — see the
  // useEffect a few hooks below for the 5s debounce.
  const [showNoChainDataPlaceholder, setShowNoChainDataPlaceholder] = useState(false);
  // Subscribed to the battle-only feed (issue #336). This invalidates only on
  // battle-cluster events within the last 3 ticks, dropping ~25% of the
  // pre-split chainEvents egress that came from re-pushing 60 events per
  // every-event insert. The WorldMap consumer only reacts to
  // `BanditAttackResolved` (see the combat-vignette effect below), which
  // currently only fires in DEMO_MODE — so we skip the subscription entirely
  // in live mode to avoid an unused reactive query (Convex `'skip'` short-
  // circuits both the WS push and the egress).
  const rawChainEvents = useQuery(
    api.events.getBattleEvents,
    DEMO_MODE ? { tickWindow: 3 } : 'skip',
  );

  // Derived live tick counter — prefer tickClock (cheap, always fresh) over
  // snapshot.tick (only updates when world data changes after delta-check).
  // Fall back to snapshot.tick for continuity during tickClock cold-start.
  // Floor against log count so we never go BACKWARDS.
  const liveTick = useMemo(
    () => Math.max(tickClock?.tick ?? snapshot?.tick ?? 0, logs.length),
    [logs, tickClock?.tick, snapshot?.tick],
  );
  const liveBandit = snapshot?.bandit ?? null;
  const visibleBandit = DEMO_MODE
    ? {
      regionKey: DEMO_BANDIT.regionId,
      state: BanditState.Camped,
      nextActionTick: DEMO_BANDIT.attacksAtTick,
      projectedTargetClanId: 2,
      isLive: false,
    }
    : liveBandit
      ? {
        regionKey: REGION_KEY_BY_CHAIN_ID[liveBandit.region],
        state: liveBandit.state,
        nextActionTick: liveBandit.nextActionTick,
        projectedTargetClanId: liveBandit.projectedTargetClanId,
        isLive: true,
      }
      : null;
  const banditTicksUntil = visibleBandit ? visibleBandit.nextActionTick - liveTick : 999;
  const shouldPulseBandit =
    !!visibleBandit
    && (
      visibleBandit.state === BanditState.Attacking
      || (banditTicksUntil <= 2 && banditTicksUntil >= 0)
    );

  useEffect(() => {
    liveTickRef.current = liveTick;
    if (liveTickClockRef.current.tick !== liveTick) {
      liveTickClockRef.current = { tick: liveTick, seenAtMs: Date.now() };
    }
  }, [liveTick]);

  useEffect(() => {
    if (tickClock) {
      tickClockEpochRef.current = {
        tick: tickClock.tick,
        startedAt: tickClock.tickEpochStartedAt,
        durationMs: tickClock.tickEpochDurationMs,
      };
    }
  }, [tickClock]);

  useEffect(() => {
    snapshotRef.current = snapshot;
    const rawTick = snapshot?.tick;
    if (typeof rawTick === 'number' && Number.isFinite(rawTick)) {
      tickClockRef.current = { tick: rawTick, seenAtMs: Date.now() };
    }
  }, [snapshot]);

  // 5-second grace period before showing the "no chain data yet" placeholder.
  // If chain data is present, hide immediately. If it's empty, wait 5s before
  // flipping the placeholder on — so fast Convex reconnects (e.g. iOS Safari
  // PWA returns) never reveal the bare-terrain overlay. Combined with the
  // localStorage cache in useCachedSnapshot above, most reconnects render the
  // last-known state immediately and never trip this timer at all.
  useEffect(() => {
    if (DEMO_MODE || hasClans) {
      setShowNoChainDataPlaceholder(false);
      return;
    }
    const timer = window.setTimeout(() => setShowNoChainDataPlaceholder(true), 5000);
    return () => window.clearTimeout(timer);
  }, [hasClans]);

  // Snapshot-diff: derive bandit resolution outcome the moment the chain transitions
  // out of Camped. See docs/planning/bandit-animation-impl-plan.md §"Snapshot diff
  // tracking". The lag-by-one-tick design is required because resource deposits
  // settle end-of-tick BEFORE bandit resolution, so frontend cannot pre-compute
  // the winner — we observe the closure and derive outcome from the diff.
  useEffect(() => {
    const prev = prevBanditRef.current;
    const curr = (snapshot?.bandit ?? null) as SnapshotBandit | null;
    const tick = snapshot?.tick;

    const wasResolutionCandidate =
      !!prev && (
        (prev.state === BanditState.Camped && prev.nextActionTick <= (tick ?? -Infinity))
        || prev.state === BanditState.Attacking
        || prev.state === BanditState.Defeated
      );

    if (typeof tick === 'number' && wasResolutionCandidate && prev) {
      // The resolution tick has closed (or already passed). Diff prev vs curr.
      if (!curr) {
        if (prev.state !== BanditState.Defeated) {
          // Bandit removed entirely.
          // Backend snapshots do not expose attackAttemptsMade yet, so we cannot
          // discriminate terminal no-target escape from defeat. Prefer defeated
          // until a compact lastResolution snapshot field is available.
          // Carry the projected target so the circle/battle animation can anchor
          // to the actual base sprite world coords (not a stale fromAnchor offset).
          const hadTarget = typeof prev.projectedTargetClanId === 'number' && prev.projectedTargetClanId > 0;
          lastBanditOutcomeRef.current = {
            type: 'defeated',
            resolvedTick: tick,
            fromRegion: prev.region,
            targetClanId: hadTarget ? String(prev.projectedTargetClanId) : null,
          };
        } else {
          // Live synth in computeBanditAnimPhase already ran the death animation.
          // Don't overwrite lastBanditOutcomeRef with the purge tick.
        }
      } else if (curr.region !== prev.region && prev.state !== BanditState.Defeated) {
        // Bandit advanced to a new region.
        // Win-with-rampage and no-target-advance are visually different (battle vs
        // walk-through). Since the backend doesn't yet expose a "battle happened"
        // flag in the snapshot, we default to 'won' (battle path) — the snapshot
        // shape carries projectedTargetClanId on the prev bandit; if it was set
        // but the prev region had no defenders we lean toward no_battle_advance.
        // First-pass heuristic: if prev.projectedTargetClanId was 0/undefined,
        // treat as no_battle_advance.
        const hadTarget = typeof prev.projectedTargetClanId === 'number' && prev.projectedTargetClanId > 0;
        lastBanditOutcomeRef.current = hadTarget
          ? {
            type: 'won',
            resolvedTick: tick,
            fromRegion: prev.region,
            toRegion: curr.region,
            targetClanId: String(prev.projectedTargetClanId),
          }
          : {
            type: 'no_battle_advance',
            resolvedTick: tick,
            fromRegion: prev.region,
            toRegion: curr.region,
          };
      } else if (curr.region === prev.region && curr.stateEnteredTick > prev.stateEnteredTick) {
        // Same region, new state-enter tick: legacy "retry in place" — snapshot diff
        // semantically the same as no resolution (just a counter bump). Skip outcome.
      }
    }

    prevBanditRef.current = curr;
    const existing = lastBanditOutcomeRef.current;
    if (existing && (currentTickFloat() - existing.resolvedTick) >= BATTLE_T_FADE_END) {
      lastBanditOutcomeRef.current = null;
    }
  }, [snapshot]);

  function getDayNightProgress() {
    const clockEpoch = tickClockEpochRef.current;
    const snap = snapshotRef.current;
    const tick = clockEpoch?.tick ?? snap?.tick;
    const epoch = clockEpoch
      ? { startedAt: clockEpoch.startedAt, durationMs: clockEpoch.durationMs }
      : snap?.tickEpoch;
    const hasEpoch = !!epoch && typeof epoch.startedAt === 'number' && epoch.startedAt > 0;
    if (typeof tick === 'number' && Number.isFinite(tick) && (tick > 0 || hasEpoch)) {
      let subTickProgress = 0;
      if (hasEpoch && typeof epoch.durationMs === 'number' && epoch.durationMs > 0) {
        const startedAtMs = epoch.startedAt < 10_000_000_000 ? epoch.startedAt * 1000 : epoch.startedAt;
        subTickProgress = clamp01((Date.now() - startedAtMs) / epoch.durationMs);
      } else {
        const elapsed = Date.now() - tickClockRef.current.seenAtMs;
        subTickProgress = clamp01(elapsed / FALLBACK_DAY_TICK_MS);
      }
      return ((tick + subTickProgress) % TICKS_PER_DAY_CYCLE) / TICKS_PER_DAY_CYCLE;
    }
    return ((Date.now() / FALLBACK_DAY_TICK_MS) % TICKS_PER_DAY_CYCLE) / TICKS_PER_DAY_CYCLE;
  }

  function fitWorldAnimated() {
    const viewport = viewportRef.current;
    const wrap = canvasWrapRef.current;
    if (!viewport || !wrap) return;
    const fitScale = Math.max(
      (wrap.clientWidth || viewport.screenWidth) / WORLD_WIDTH,
      (wrap.clientHeight || viewport.screenHeight) / WORLD_HEIGHT,
    );
    viewport.plugins.remove('animate');
    viewport.animate({
      position: { x: WORLD_WIDTH / 2, y: WORLD_HEIGHT / 2 },
      scale: fitScale,
      time: 400,
      ease: 'easeInOutQuad',
    });
  }

  function clearSelection() {
    const selected = selectedRef.current;
    if (!selected && !selectedClanIdRef.current) return;
    if (selected) {
      selected.target.removeChild(selected.ring);
      selected.ring.destroy();
    }
    selectedRef.current = null;
    selectedClanIdRef.current = null;
    setSelectedClanId(null);
    applyClanFocus(null);
    fitWorldAnimated();
  }

  function selectTarget(target: SelectableTarget, color: number): boolean {
    const viewport = viewportRef.current;
    if (!viewport) return false;
    // No-op during active combat vignette — a fresh selection ring would
    // appear inside the dimmed combat scene, undercutting the focus and
    // potentially persisting after the dim layer fades (codex 5.4 LOW).
    if (combatVignetteRef.current) return false;
    let ring = selectedRef.current?.ring;
    if (!ring) {
      ring = new Graphics();
    } else if (ring.parent) {
      ring.parent.removeChild(ring);
    }
    const radius = Math.max(18, Math.max(target.width || 0, target.height || 0) * 0.7);
    drawSelectionRing(ring, radius, color);
    ring.visible = true;
    ring.alpha = 1;
    ring.rotation = 0;
    target.addChildAt(ring, 0);
    selectedRef.current = { target, ring, color };

    const global = target.getGlobalPosition();
    const world = viewport.toWorld(global);
    viewport.plugins.remove('animate');
    viewport.animate({
      position: { x: world.x, y: world.y },
      scale: 2.0,
      time: 400,
      ease: 'easeInOutQuad',
    });
    return true;
  }

  function applyClanFocus(clanId: string | null) {
    const drawn = drawnRef.current;
    const layers = layersRef.current;
    if (layers) {
      layers.terrainBackground.alpha = clanId ? 0.35 : 1;
      layers.inWorldEffects.alpha = clanId ? 0.45 : 1;
      layers.bubbleLayer.alpha = clanId ? 0.45 : 1;
    }

    drawn.clanZones.forEach(({ gfx, clan }) => {
      gfx.alpha = clanId && clan.id !== clanId ? 0.16 : 1;
    });
    drawn.bases.forEach(({ container, clan }) => {
      container.alpha = clanId && clan.id !== clanId ? 0.18 : 1;
    });
    drawn.liveClansmen.forEach((marker) => {
      marker.node.alpha = clanId && marker.clanId !== clanId ? 0.18 : 1;
      if (marker.route) marker.route.line.alpha = clanId && marker.clanId !== clanId ? 0.12 : 1;
    });
    travelsRef.current.forEach((travel) => {
      const dim = clanId && travel.clanId !== clanId;
      if (dim) {
        travel.gfx.alpha = Math.min(travel.gfx.alpha, 0.18);
        travel.route.line.alpha = 0.12;
      }
    });
  }

  // ---- Pixel burst helpers --------------------------------------------------

  function triggerPixelBurst(worldX: number, worldY: number, color: number, count = 12) {
    const layer = layersRef.current?.inWorldEffects;
    if (!layer) return;
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 + (Math.random() - 0.5) * 0.6;
      const speed = 1.2 + Math.random() * 2.8;
      const size = 2 + Math.floor(Math.random() * 3);
      const gfx = new Graphics();
      gfx.rect(-size / 2, -size / 2, size, size);
      gfx.fill({ color, alpha: 1 });
      gfx.x = worldX;
      gfx.y = worldY;
      layer.addChild(gfx);
      burstParticlesRef.current.push({
        gfx,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed * 0.65,
        life: 1,
        decayRate: 0.016 + Math.random() * 0.014,
      });
    }
  }

  // ---- Pixi init ------------------------------------------------------------
  useEffect(() => {
    isMountedRef.current = true;
    let mounted = true;
    let canvasClickHandler: ((event: MouseEvent) => void) | null = null;
    let pixiCanvas: HTMLCanvasElement | null = null;
    const app = new Application();
    appRef.current = app;

    const wrap = canvasWrapRef.current!;
    const initialW = wrap.clientWidth || 800;
    const initialH = wrap.clientHeight || 600;

    app
      .init({
        width: initialW,
        height: initialH,
        background: 0x1a2a1a,
        antialias: true,
        // Cap at 2x — uncapped dpr (3x on iPhone 14 Pro) creates a ~40MB GPU
        // texture for the world map and accelerates WebGL context loss on mobile.
        resolution: Math.min(window.devicePixelRatio || 1, 2),
        autoDensity: true,
      })
      .then(async () => {
        if (!mounted || !isMountedRef.current || !canvasWrapRef.current) return;
        canvasWrapRef.current.appendChild(app.canvas);
        pixiCanvas = app.canvas;
        // CSS: stretch to wrapper. The ghost (MapGhostLayer) sits at z-index 2
        // so it covers the canvas during warmup; the canvas sits at z-index 1
        // BELOW the ghost. Once `pixiReady` fires the ghost fades out and
        // unmounts, leaving only the canvas. pointer-events:none on the ghost
        // ensures taps reach the canvas even before the fade completes.
        app.canvas.style.display = 'block';
        app.canvas.style.position = 'absolute';
        app.canvas.style.inset = '0';
        app.canvas.style.zIndex = '1';
        app.canvas.style.width = '100%';
        app.canvas.style.height = '100%';
        // Round-6 pinch fix: pixi-viewport handles multi-touch internally, so
        // canvas touch-action is 'none' (we own all gestures inside the canvas).
        // Browser-level pinch is locked via index.html viewport meta.
        app.canvas.style.touchAction = 'none';
        // Defensive — block iOS WebKit's 300ms double-tap delay + ensure no
        // stray multi-touch escapes to the page-level zoom.
        app.canvas.addEventListener('touchstart', (e) => {
          if (e.touches.length > 1) e.preventDefault();
        }, { passive: false });
        // Mobile browsers (especially iOS Safari) reclaim WebGL contexts under
        // memory pressure or when the tab is backgrounded. Without a handler the
        // canvas stays black. We surface a reload prompt via React state so the
        // WorldMapBoundary can show a recoverable overlay.
        app.canvas.addEventListener('webglcontextlost', (e) => {
          e.preventDefault();
          if (isMountedRef.current) setWebglLost(true);
        }, false);
        canvasClickHandler = (event: MouseEvent) => {
          const viewportNow = viewportRef.current;
          if (!viewportNow || combatVignetteRef.current) return;
          const rect = app.canvas.getBoundingClientRect();
          const world = viewportNow.toWorld(event.clientX - rect.left, event.clientY - rect.top);
          const hitBase = drawnRef.current.bases.find(({ container }) => {
            const hitArea = container.hitArea;
            if (!(hitArea instanceof Rectangle)) return false;
            const lx = world.x - container.x;
            const ly = world.y - container.y;
            return hitArea.contains(lx, ly);
          });
          if (hitBase) {
            if (selectTarget(hitBase.container as SelectableTarget, hitBase.clan.color)) {
              setSelectedClanId(hitBase.clan.id);
            }
            return;
          }
          clearSelection();
        };
        app.canvas.addEventListener('click', canvasClickHandler);

        // pixi-viewport: wraps all map layers (bg, regions, sigils, bases,
        // bubbles, travel dots) so .pinch() / .drag() / .wheel() handle
        // multi-touch math at the application layer. Round 5's
        // canvas.style.touchAction='pinch-zoom' approach was unreliable on
        // mobile WebKit; this is the canonical fix per Pixi docs.
        const viewport = new Viewport({
          screenWidth: initialW,
          screenHeight: initialH,
          worldWidth: WORLD_WIDTH,
          worldHeight: WORLD_HEIGHT,
          events: app.renderer.events,
        });
        app.stage.addChild(viewport); // viewport is the only direct child of stage
        // Fit-cover scale: smallest scale where the map fully covers the screen
        // (no dead background space on either axis). minScale = fitScale means
        // user CANNOT zoom out past fit; map always fills the screen.
        const initialFitScale = Math.max(
          initialW / WORLD_WIDTH,
          initialH / WORLD_HEIGHT,
        );
        if (CAPTURE_MODE) {
          // Capture mode: attach NO interaction plugins. A scripted cinematic
          // camera (driven by the hero-video harness via window.__cwCapture)
          // owns the viewport; skipping clampZoom also lets the camera push
          // past the normal fit*4 zoom ceiling for tighter beauty shots.
          viewport.setZoom(initialFitScale, true);
          viewport.moveCenter(WORLD_WIDTH / 2, WORLD_HEIGHT / 2);
        } else {
          viewport
            .drag()
            .pinch()
            .wheel()
            .decelerate()
            .clampZoom({ minScale: initialFitScale, maxScale: initialFitScale * 4 })
            .clamp({ direction: 'all', underflow: 'center' });
          viewport.setZoom(initialFitScale, true);
          viewport.moveCenter(WORLD_WIDTH / 2, WORLD_HEIGHT / 2);
        }
        viewportRef.current = viewport;

        if (CAPTURE_MODE && typeof window !== 'undefined') {
          // Expose a minimal camera handle for the Playwright hero-video
          // harness. All keyframe/easing logic lives in the harness so the
          // cinematic can be re-tuned without an app rebuild.
          (window as unknown as { __cwCapture?: unknown }).__cwCapture = {
            viewport,
            world: { width: WORLD_WIDTH, height: WORLD_HEIGHT },
            fitScale: initialFitScale,
            ready: true,
          };
        }

        // Persist + restore pan/zoom so iOS Safari tab eviction (or HMR full
        // reload during dev) doesn't lose the user's current view. Keyed in
        // sessionStorage so it's tab-scoped — closing the tab resets to fit.
        // `VIEWPORT_STORAGE_KEY` is env+diamond scoped (see issue #300) so
        // switching backends or realms doesn't surface stale viewport state.
        try {
          // Capture mode owns the camera — never restore a saved viewport.
          const raw = CAPTURE_MODE ? null : sessionStorage.getItem(VIEWPORT_STORAGE_KEY);
          if (raw) {
            const saved = JSON.parse(raw) as { cx: number; cy: number; scale: number };
            // Bounds-clamp: a poisoned viewport entry (e.g. cx=99999,
            // cy=99999 from a since-shrunk world or storage corruption) would
            // restore the viewport to an off-world center and the user would
            // see a mostly-blank canvas. Reject out-of-range coords entirely
            // and fall through to the fit-cover default just below.
            if (
              Number.isFinite(saved.cx) &&
              Number.isFinite(saved.cy) &&
              Number.isFinite(saved.scale) &&
              saved.scale >= initialFitScale &&
              saved.scale <= initialFitScale * 4 &&
              saved.cx >= 0 && saved.cx <= WORLD_WIDTH &&
              saved.cy >= 0 && saved.cy <= WORLD_HEIGHT
            ) {
              viewport.setZoom(saved.scale, true);
              viewport.moveCenter(saved.cx, saved.cy);
            }
          }
        } catch {
          // malformed state or storage disabled — fall back to fit-cover default
        }
        const saveViewportState = () => {
          try {
            sessionStorage.setItem(
              VIEWPORT_STORAGE_KEY,
              JSON.stringify({ cx: viewport.center.x, cy: viewport.center.y, scale: viewport.scale.x }),
            );
          } catch {
            // quota / private-mode — swallow
          }
        };
        viewport.on('moved', saveViewportState);
        viewport.on('zoomed', saveViewportState);

        const layers = createWorldLayers();
        const backgroundHitArea = new Graphics();
        backgroundHitArea.eventMode = 'static';
        backgroundHitArea.hitArea = new Rectangle(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
        backgroundHitArea.on('pointertap', () => {
          clearSelection();
        });
        layers.terrainBackground.addChild(backgroundHitArea);
        viewport.addChild(
          layers.worldContainer,
          layers.inWorldEffects,
          layers.selectionRings,
          layers.bubbleLayer,
          layers.screenEffects,
        );
        if (ENABLE_DAY_NIGHT_EFFECT) {
          const dayNightFilter = new ColorMatrixFilter();
          layers.worldContainer.filters = [dayNightFilter];
          dayNightFilterRef.current = dayNightFilter;
        }
        layersRef.current = layers;
        bubbleLayerRef.current = layers.bubbleLayer;
        travelLayerRef.current = layers.worldDynamic;

        // 1. Background terrain map (PR #40) — fantasy strategy art generated to match REGIONS layout.
        // Loaded async; sprite is added to terrainBackground BEFORE buildScene so region circles render on top.
        try {
          const tex = await Assets.load(worldMapBg);
          if (!mounted || !isMountedRef.current) return;
          const bg = new Sprite(tex);
          // Render at native world resolution; viewport handles screen-fit zoom.
          bg.width = MAP_WIDTH;
          bg.height = MAP_HEIGHT;
          bg.x = 0;
          bg.y = 0;
          layers.terrainBackground.addChild(bg);
          drawnRef.current.bgSprite = bg;
        } catch (err) {
          // Non-fatal — fall through to flat background color set in app.init
          console.warn('[WorldMap] failed to load terrain background', err);
        }

        // 1b. Winter map overlay — same dimensions as the base map (1086x1448),
        // alpha-modulated above. Layered AFTER the base map but BEFORE the
        // region polygons / labels / clan zones (those get addChild'd later in
        // buildScene), so it visually sits between ground art and gameplay
        // overlays. Kept invisible (alpha=0) until a Winter season transition
        // flips the state machine to `fade-in`.
        //
        // Pre-allocated once per Pixi-init so we never pay the 3.8MB upload
        // cost mid-season. Texture load failure is non-fatal — without the
        // sprite, the only visible degradation is that the snow particles
        // (winterSnow.ts) won't be accompanied by ground recoloring, which is
        // still a usable Winter visual.
        try {
          const winterTex = await Assets.load(worldMapWinterBg);
          if (!mounted || !isMountedRef.current) return;
          const winterSprite = new Sprite(winterTex);
          winterSprite.width = MAP_WIDTH;
          winterSprite.height = MAP_HEIGHT;
          winterSprite.x = 0;
          winterSprite.y = 0;
          winterSprite.alpha = 0;
          // `eventMode = 'none'` ensures the sprite never intercepts pointer
          // events meant for region polygons / clan bases sitting above it in
          // the same Container.
          winterSprite.eventMode = 'none';
          layers.terrainBackground.addChild(winterSprite);
          winterSpriteRef.current = winterSprite;
        } catch (err) {
          // Non-fatal — fall through; the snow particle effect still plays.
          console.warn('[WorldMap] failed to load winter map overlay', err);
        }

        // 2. Build scene (regions, sigil sprites, bandit indicator) — PR #41 + PR #42 logic
        // Layers are added to `viewport` (not app.stage) so pinch/drag affect them.
        buildScene(() => !mounted || !isMountedRef.current);

        // 3. Speech bubble ticker (PR #43) — bubbleLayer sits above selection/effects.
        const bubbleLayer = layers.bubbleLayer;

        const cb = (ticker: { deltaMS: number }) => {
          const now = performance.now();
          const byClan = bubblesByClanRef.current;
          for (const [clanId, list] of byClan) {
            // Update alphas; remove dead bubbles.
            for (let i = list.length - 1; i >= 0; i--) {
              const b = list[i];
              if (!b) continue;
              const age = now - b.bornAt;
              let alpha: number;
              if (age < FADE_IN_MS) {
                alpha = age / FADE_IN_MS;
              } else if (age < FADE_IN_MS + HOLD_MS) {
                alpha = 1;
              } else if (age < b.lifeMs) {
                const fadeAge = age - FADE_IN_MS - HOLD_MS;
                alpha = 1 - fadeAge / FADE_OUT_MS;
              } else {
                alpha = 0;
              }
              b.container.alpha = Math.max(0, Math.min(1, alpha));
              if (age >= b.lifeMs) {
                bubbleLayer.removeChild(b.container);
                b.container.destroy({ children: true });
                list.splice(i, 1);
              }
            }
            // Restack: oldest closest to flag, newest on top.
            // Only the bottommost bubble (index 0) shows its tail — upper bubbles
            // would point to empty air, which looks broken.
            const anchor = flagAnchorsRef.current.get(clanId);
            if (anchor && list.length > 0) {
              let cursorY = anchor.y - BUBBLE_FLAG_OFFSET_Y;
              for (let i = 0; i < list.length; i++) {
                const b = list[i];
                if (!b) continue;
                b.container.x = anchor.x;
                b.container.y = cursorY;
                b.tail.visible = i === 0;
                cursorY -= b.height + BUBBLE_STACK_GAP;
              }
            }
            if (list.length === 0) byClan.delete(clanId);
          }
          void ticker.deltaMS;
        };
        tickerCbRef.current = cb;
        app.ticker.add(cb);

        // 3b. Worker travel ticker (PR #44) — clansmen live in worldDynamic so
        // they Y-sort against bases and bandits.
        const travelLayer = layers.worldDynamic;

        const travelCb = (_ticker: { deltaMS: number }) => {
          const layer = travelLayerRef.current;
          if (!layer) return;
          const now = performance.now();
          const list = travelsRef.current;

          for (let i = list.length - 1; i >= 0; i--) {
            const t = list[i];
            if (!t) continue;
            const from = REGIONS.find(r => r.id === t.fromRegionKey);
            const to = REGIONS.find(r => r.id === t.toRegionKey);
            if (!from || !to) {
              if (selectedRef.current?.target === t.gfx) selectedRef.current = null;
              t.route.line.parent?.removeChild(t.route.line);
              t.route.line.destroy();
              layer.removeChild(t.gfx);
              t.gfx.destroy({ children: true });
              list.splice(i, 1);
              continue;
            }
            const elapsed = now - t.startedAt;
            const progress = elapsed / t.durationMs;
            const position = routePoint(t.route, now);
            redrawRouteLine(t.route, now);
            const destination = projectedRegionAnchor(t.toRegionKey);

            if (progress >= 1) {
              const fadeAge = elapsed - t.durationMs;
              // Linger at destination at full alpha for TRAVEL_DEST_LINGER_MS,
              // THEN fade. Keeps arrival visible — answers "clansmen disappear" bug.
              if (fadeAge >= TRAVEL_DEST_LINGER_MS + TRAVEL_FADE_OUT_MS) {
                if (selectedRef.current?.target === t.gfx) selectedRef.current = null;
                t.route.line.parent?.removeChild(t.route.line);
                t.route.line.destroy();
                layer.removeChild(t.gfx);
                t.gfx.destroy({ children: true });
                list.splice(i, 1);
                continue;
              }
              // Tiny jitter at destination so the cluster reads as living units, not pinned dots
              const jit = Math.sin((now + (t.id.charCodeAt(t.id.length - 1) * 137)) / 220) * 1.5;
              t.gfx.x = (destination?.x ?? position?.x ?? 0) + jit;
              t.gfx.y = (destination?.y ?? position?.y ?? 0) + jit * 0.6;
              t.gfx.zIndex = Math.round(t.gfx.y);
              t.carry.targetFill = 0;
              if (fadeAge < TRAVEL_DEST_LINGER_MS) {
                t.gfx.alpha = 1;
              } else {
                const fOff = fadeAge - TRAVEL_DEST_LINGER_MS;
                t.gfx.alpha = Math.max(0, 1 - fOff / TRAVEL_FADE_OUT_MS);
                t.route.line.alpha = t.gfx.alpha;
              }
            } else {
              if (!position) continue;
              t.gfx.x = position.x;
              t.gfx.y = position.y;
              t.gfx.zIndex = Math.round(t.gfx.y);
              setCarryTargetFromCarry(t.carry, {
                wood: WOOD_CAP * Math.min(1, progress),
              });
              // Subtle fade-in over first 150ms so dots don't pop in
              t.gfx.alpha = Math.min(1, elapsed / 150);
            }
            if (selectedClanIdRef.current && t.clanId !== selectedClanIdRef.current) {
              t.gfx.alpha = Math.min(t.gfx.alpha, 0.18);
              t.route.line.alpha = 0.12;
            }
            const lerpFactor = t.carry.targetFill >= t.carry.displayedFill ? 0.15 : 0.28;
            t.carry.displayedFill += (t.carry.targetFill - t.carry.displayedFill) * lerpFactor;
            redrawCarryIndicator(t.carry);
          }
        };
        travelTickerCbRef.current = travelCb;
        app.ticker.add(travelCb);

        // 3c. Zone-pulse ticker — gently breathe alpha on each clan zone halo so
        // the map feels alive even when no logs are attributable. Visual heartbeat.
        const zonePulseCb = () => {
          const drawn = drawnRef.current;
          const t = performance.now() / 1000;
          drawn.clanZones.forEach(({ gfx, clan }, i) => {
            // Each zone breathes on a slightly different phase
            const phase = (t + i * 0.7) * 1.1;
            const a = 0.78 + 0.22 * Math.sin(phase);
            const selectedClanId = selectedClanIdRef.current;
            gfx.alpha = selectedClanId && clan.id !== selectedClanId ? 0.16 : a;
          });
          const now = performance.now();
          drawn.bases.forEach((base) => {
            if (base.baseY <= 0) return;
            // Breathing: scaleY stretches upward from the sprite's bottom anchor
            // (0.5, 1). 0.25 Hz period; 3% amplitude reads as alive without skewing
            // the painted rooflines. phaseOffset keeps bases out of sync.
            // zIndex is already set during relayout (base.baseY is static between
            // relayouts), so no need to reassign each tick.
            // IMPORTANT: multiply by baseScaleY (the natural scale captured at
            // relayout). Setting scale.y directly would clobber the
            // sprite.height=baseSize sizing and stretch the sprite ~3x tall.
            const breath = 1 + Math.sin((now + base.phaseOffset) * Math.PI / 2000) * 0.03;
            if (base.sprite) {
              base.sprite.scale.y = base.baseScaleY * breath;
            } else {
              base.fallback.scale.y = base.baseScaleY * breath;
            }
          });
          updateLiveClansmanPositions();
        };
        app.ticker.add(zonePulseCb);
        // Stash cleanup ref via the same pattern as travel ticker (re-use travelTickerCbRef).
        // Track separately:
        zonePulseCbRef.current = zonePulseCb;

        const dayNightCb = () => {
          if (ENABLE_DAY_NIGHT_EFFECT) {
            const filter = dayNightFilterRef.current;
            if (filter) {
              const frame = getDayNightFrame(getDayNightProgress());
              applyDayNightFilter(filter, frame);
              const glowAlpha = clamp01(1 - frame.brightness);
              drawnRef.current.bases.forEach((base) => {
                base.glow.alpha = glowAlpha;
              });
            }
          } else {
            drawnRef.current.bases.forEach((base) => {
              base.glow.alpha = 0;
            });
          }

          const selected = selectedRef.current;
          if (selected) {
            const ring = selected.ring;
            const now = performance.now();
            ring.rotation += (app.ticker.deltaMS / 1000) * Math.PI * 2;
            ring.alpha = 0.6 + Math.sin((now / 1000) * Math.PI) * 0.4;
          }
        };
        dayNightTickerCbRef.current = dayNightCb;
        app.ticker.add(dayNightCb);

        const combatCb = () => {
          updateCombatVignette();
        };
        combatTickerCbRef.current = combatCb;
        app.ticker.add(combatCb);

        // Bandit attack animation ticker (docs/planning/bandit-animation-impl-plan.md).
        // Drives the phase machine: camp_idle / camp_telegraph / battle / advance / escape.
        // Runs after combatCb so DEMO mode's vignette gets first-write to combatDim/Flash.
        const banditAnimCb = () => {
          updateBanditAnimation();
        };
        banditAnimTickerCbRef.current = banditAnimCb;
        app.ticker.add(banditAnimCb);

        // Pixel burst ticker — animates flying pixels for deposit/trade events.
        const burstCb = () => {
          const particles = burstParticlesRef.current;
          const layer = layersRef.current?.inWorldEffects;
          if (!layer || particles.length === 0) return;
          for (let i = particles.length - 1; i >= 0; i--) {
            const p = particles[i];
            if (!p) continue;
            p.gfx.x += p.vx;
            p.gfx.y += p.vy;
            p.vy += 0.08; // light gravity
            p.life -= p.decayRate;
            p.gfx.alpha = Math.max(0, p.life);
            if (p.life <= 0) {
              layer.removeChild(p.gfx);
              p.gfx.destroy();
              particles.splice(i, 1);
            }
          }
        };
        burstTickerCbRef.current = burstCb;
        app.ticker.add(burstCb);

        // Winter snowfall overlay. Lives directly on app.stage (NOT inside the
        // pixi-viewport) so particles stay in screen space — falling from the
        // top of the visible canvas regardless of how the user has panned/zoomed
        // the world. Stage children: [viewport, snow.container]. React DOM
        // (TopHud / EventTicker / status badges) renders above the canvas in
        // the DOM, so it sits above the snow naturally. Honors
        // `prefers-reduced-motion`: when set, we skip creating the system at
        // all so we never spend ticker cycles on motion the user opted out of.
        //
        // v2.5.2 (issue #250): also subscribe to the MediaQueryList's `change`
        // event so toggling OS motion preference mid-session takes effect.
        // Previously the value was sampled exactly once at init — if the user
        // turned reduced-motion ON, snow kept animating; if they turned it OFF
        // after init, the handle was never created and snow never appeared.
        const mq =
          typeof window !== 'undefined' && typeof window.matchMedia === 'function'
            ? window.matchMedia('(prefers-reduced-motion: reduce)')
            : null;
        if (!mq || !mq.matches) {
          const snow = createWinterSnow(app, { particleCount: 100 });
          app.stage.addChild(snow.container);
          winterSnowRef.current = snow;
        }
        if (mq) {
          const handleChange = () => {
            const currentApp = appRef.current;
            if (!currentApp) return;
            if (mq.matches) {
              // User just turned reduced-motion ON. If the snow system was
              // built, deactivate it (setActive(false) freezes the particles
              // and stops the ticker callback) — leave the handle in place so
              // a subsequent OFF toggle can re-enable without re-allocating.
              winterSnowRef.current?.setActive(false);
            } else {
              // User just turned reduced-motion OFF. Lazily build the handle
              // if init skipped it (reducedMotion was true at startup), then
              // restore the snapshot-driven active state. winterActive is typed
              // in the getSnapshot return type via deriveSeasonState().
              if (!winterSnowRef.current) {
                const snow = createWinterSnow(currentApp, { particleCount: 100 });
                currentApp.stage.addChild(snow.container);
                winterSnowRef.current = snow;
              }
              const winterActive = snapshotRef.current?.winterActive === true;
              winterSnowRef.current.setActive(winterActive);
            }
          };
          mq.addEventListener('change', handleChange);
          reducedMotionMqRef.current = mq;
          reducedMotionHandlerRef.current = handleChange;
        }

        // Winter map-overlay alpha ticker. Drives the fade-in/active/fade-out
        // state machine each frame in wall-clock time. The phase ref is
        // mutated by a separate useEffect that watches `snapshot.winterActive`
        // (see below) — this callback only reads phase + start markers and
        // writes `winterSprite.alpha`. Idle short-circuits before any math so
        // the per-frame cost in non-winter weather is a single ref read.
        const winterFadeCb = (): void => {
          const phase = winterFadePhaseRef.current;
          if (phase === 'idle') return;
          const sprite = winterSpriteRef.current;
          if (!sprite) return;
          const now = performance.now();
          const startAlpha = winterFadeStartAlphaRef.current;
          const startMs = winterFadeStartMsRef.current;
          if (phase === 'fade-in') {
            // Remaining duration scales with (1 - startAlpha) so a fade-in
            // resuming mid-fade-out from e.g. alpha=0.4 only spends 60% of
            // WINTER_FADE_IN_MS reaching 1.0 — symmetric with fade-out logic.
            const remainingMs = WINTER_FADE_IN_MS * (1 - startAlpha);
            const t = remainingMs > 0 ? Math.min(1, (now - startMs) / remainingMs) : 1;
            const alpha = startAlpha + (1 - startAlpha) * t;
            sprite.alpha = alpha;
            if (t >= 1) {
              sprite.alpha = 1;
              winterFadePhaseRef.current = 'active';
            }
          } else if (phase === 'active') {
            // Hold at full opacity — no per-frame work needed beyond the early
            // return, but we set alpha=1 defensively in case the snapshot
            // edge-detector skipped the fade-in (e.g. world boots in Winter).
            sprite.alpha = 1;
          } else if (phase === 'fade-out') {
            const remainingMs = WINTER_FADE_OUT_MS * startAlpha;
            const t = remainingMs > 0 ? Math.min(1, (now - startMs) / remainingMs) : 1;
            const alpha = startAlpha * (1 - t);
            sprite.alpha = alpha;
            if (t >= 1) {
              sprite.alpha = 0;
              winterFadePhaseRef.current = 'idle';
            }
          }
        };
        winterFadeTickerCbRef.current = winterFadeCb;
        app.ticker.add(winterFadeCb);

        // 4. Initial layout (PR #41) — projects normalized coords + positions flag anchors.
        // relayout now operates in WORLD space (MAP_WIDTH x MAP_HEIGHT) since the
        // viewport handles screen-fit transformation. Children inside the viewport
        // are positioned in world coords and pixi-viewport scales them to screen.
        relayout(MAP_WIDTH, MAP_HEIGHT);
        if (!mounted || !isMountedRef.current) return;
        setSize({ w: initialW, h: initialH });
        setPixiReady(true);
      })
      .catch((err: unknown) => {
        console.error('[WorldMap] failed to initialize Pixi application', err);
        if (!mounted || !isMountedRef.current) return;
        setPixiInitError(err instanceof Error ? err : new Error(String(err)));
      });

    return () => {
      mounted = false;
      isMountedRef.current = false;
      const a = appRef.current;
      if (a && tickerCbRef.current) a.ticker.remove(tickerCbRef.current);
      if (a && travelTickerCbRef.current) a.ticker.remove(travelTickerCbRef.current);
      if (a && zonePulseCbRef.current) a.ticker.remove(zonePulseCbRef.current);
      if (a && dayNightTickerCbRef.current) a.ticker.remove(dayNightTickerCbRef.current);
      if (a && combatTickerCbRef.current) a.ticker.remove(combatTickerCbRef.current);
      if (a && banditAnimTickerCbRef.current) a.ticker.remove(banditAnimTickerCbRef.current);
      if (a && burstTickerCbRef.current) a.ticker.remove(burstTickerCbRef.current);
      // Winter snow owns its own ticker callback + texture lifecycle; .destroy()
      // unregisters from the app ticker and disposes the shared snowflake
      // texture so Pixi destroy() (below) doesn't leave a GPU texture leak.
      if (winterSnowRef.current) {
        winterSnowRef.current.destroy();
        winterSnowRef.current = null;
      }
      // Winter map-overlay ticker + sprite. Destroying the sprite with the
      // texture (`{ texture: true }` would error in PIXI v8 — use the explicit
      // texture.destroy() instead) releases the 1086x1448 RGBA atlas off the
      // GPU. The sprite itself is a child of terrainBackground (inside
      // worldContainer inside the viewport) and would be cleaned by Pixi's
      // recursive destroy in app.destroy() below, but we null the ref + drop
      // the texture explicitly to match the snow-handle pattern.
      if (a && winterFadeTickerCbRef.current) {
        a.ticker.remove(winterFadeTickerCbRef.current);
        winterFadeTickerCbRef.current = null;
      }
      if (winterSpriteRef.current) {
        const winterTex = winterSpriteRef.current.texture;
        winterSpriteRef.current.destroy();
        // The PNG texture was loaded via Assets.load and is cached by the
        // PIXI Assets registry — destroying it here would also blow away any
        // future re-mount's cache hit. We let PIXI's Assets unloader handle
        // it; only the Sprite (display object) is destroyed.
        void winterTex;
        winterSpriteRef.current = null;
      }
      winterFadePhaseRef.current = 'idle';
      prevWinterActiveRef.current = null;
      // Unsubscribe the prefers-reduced-motion `change` listener (issue #250).
      // If we leave it attached, OS-level motion toggles after unmount would
      // still fire handleChange against a stale appRef — handleChange guards
      // with `if (!currentApp) return`, but cleaning up is correct hygiene.
      if (reducedMotionMqRef.current && reducedMotionHandlerRef.current) {
        reducedMotionMqRef.current.removeEventListener('change', reducedMotionHandlerRef.current);
        reducedMotionMqRef.current = null;
        reducedMotionHandlerRef.current = null;
      }
      if (pixiCanvas && canvasClickHandler) pixiCanvas.removeEventListener('click', canvasClickHandler);
      finishCombatVignette(true);
      selectedRef.current?.ring.destroy();
      selectedRef.current = null;
      bubblesByClanRef.current.clear();
      seenLogIdsRef.current.clear();
      flagAnchorsRef.current.clear();
      travelsRef.current = [];
      seenTravelLogIdsRef.current.clear();
      bubbleLayerRef.current = null;
      travelLayerRef.current = null;
      layersRef.current = null;
      tickerCbRef.current = null;
      travelTickerCbRef.current = null;
      zonePulseCbRef.current = null;
      dayNightTickerCbRef.current = null;
      combatTickerCbRef.current = null;
      banditAnimTickerCbRef.current = null;
      // Explicitly destroy BlurFilter instances on bandit glow sprites BEFORE
      // resetting the arrays / running app.destroy() below (issue #251). Each
      // of 3 walker glows + 3 death glows owns its own BlurFilter, and each
      // filter allocates a render-target framebuffer on the GPU. PixiJS v8's
      // DestroyOptions has no `filters` flag (verified via @types/pixi.js
      // 8.18 — destroyTypes.d.ts exposes only children/texture/textureSource/
      // context/style), and Sprite.destroy() does NOT cascade into the
      // sprite's `filters[]` array. Without this loop the FBOs leak across
      // vite HMR cycles in dev, and across StrictMode double-mount in prod-
      // mode builds.
      const glowSprites = [
        ...banditAnimRef.current.walkerGlows,
        ...banditAnimRef.current.deathGlows,
      ];
      for (const glow of glowSprites) {
        const filters = glow.filters;
        if (Array.isArray(filters)) {
          for (const filter of filters) {
            try {
              filter.destroy();
            } catch (err) {
              if (import.meta.env.DEV) {
                console.debug('[WorldMap] glow filter destroy noop:', err);
              }
            }
          }
          glow.filters = null;
        }
      }
      // Reset bandit animation state — sprite refs survive Pixi destroy via
      // child-tree cleanup, but we need to clear the cached state so the next
      // mount re-loads textures fresh.
      banditAnimRef.current = {
        campSprite: null,
        campGlow: null,
        walkers: [],
        deathSprites: [],
        walkerGlows: [],
        deathGlows: [],
        walkTextures: { ne: [], se: [] },
        deathTextures: [],
        campTexture: null,
        assetsReady: false,
        isLoading: false,
      };
      prevBanditRef.current = null;
      lastBanditOutcomeRef.current = null;
      burstTickerCbRef.current = null;
      burstParticlesRef.current = [];
      seenBurstLogIdsRef.current.clear();
      dayNightFilterRef.current = null;
      drawnRef.current = {
        regions: [],
        regionLabels: [],
        regionPolygons: [],
        regionVertexLabels: [],
        clanZones: [],
        bases: [],
        levelBadges: [],
        liveClansmen: [],
        flags: [],
        walls: [],
        monuments: [],
        banditIcon: null,
        banditSprite: null,
        banditCountdown: null,
        bgSprite: null,
      };
      viewportRef.current = null;
      appRef.current = null;
      // PIXI v8 + React StrictMode double-invoke guard: the second cleanup
      // pass hits an already-destroyed Application where internal fields like
      // _cancelResize are undefined. Wrap in try/catch — first destroy is the
      // real one, second is benign noise.
      try {
        a?.destroy(true);
      } catch (err) {
        if (import.meta.env.DEV) {
          console.debug('[WorldMap] destroy noop (StrictMode double-invoke):', err);
        }
      }
    };
  }, []);

  // ---- Resize observer: recompute layout on viewport / orientation change --
  useEffect(() => {
    if (!pixiReady) return;
    const wrap = canvasWrapRef.current;
    const app = appRef.current;
    if (!wrap || !app) return;

    const handleResize = () => {
      if (!appRef.current) return;
      const w = wrap.clientWidth;
      const h = wrap.clientHeight;
      if (w <= 0 || h <= 0) return;
      app.renderer.resize(w, h);
      // Update pixi-viewport's screen dimensions so pinch/drag math tracks
      // the new canvas size. World dims stay fixed at WORLD_WIDTH/HEIGHT.
      const vp = viewportRef.current;
      if (vp) {
        vp.resize(w, h, WORLD_WIDTH, WORLD_HEIGHT);
        // Recompute fit-cover scale for the new screen size; reapply zoom/pan
        // clamps so user still can't zoom out past fit or pan into dead space.
        const fitScale = Math.max(w / WORLD_WIDTH, h / WORLD_HEIGHT);
        vp.clampZoom({ minScale: fitScale, maxScale: fitScale * 4 });
        vp.clamp({ direction: 'all', underflow: 'center' });
        // Snap back to fit if current zoom dropped below the new floor.
        if (vp.scale.x < fitScale) {
          vp.setZoom(fitScale, true);
          vp.moveCenter(WORLD_WIDTH / 2, WORLD_HEIGHT / 2);
        }
      }
      // relayout positions everything in WORLD coords now, not screen coords.
      relayout(WORLD_WIDTH, WORLD_HEIGHT);
      setSize({ w, h });
    };

    const ro = new ResizeObserver(handleResize);
    ro.observe(wrap);
    window.addEventListener('orientationchange', handleResize);
    return () => {
      ro.disconnect();
      window.removeEventListener('orientationchange', handleResize);
    };
  }, [pixiReady]);

  useEffect(() => {
    if (!pixiReady) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        clearSelection();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pixiReady]);

  useEffect(() => {
    selectedClanIdRef.current = selectedClanId;
    if (pixiReady) applyClanFocus(selectedClanId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pixiReady, selectedClanId]);

  // ---- One-time: create Pixi display objects (refs hold them for relayout) -
  // All layers attach to `viewport` (not app.stage) so pixi-viewport's pinch /
  // drag transforms apply to the whole map atomically.
  function clearLiveClanVisuals() {
    const drawn = drawnRef.current;
    drawn.clanZones.forEach(({ gfx }) => gfx.destroy());
    drawn.bases.forEach(({ container }) => container.destroy({ children: true }));
    drawn.levelBadges.forEach(({ bg, label }) => {
      bg.destroy();
      label.destroy();
    });
    drawn.clanZones = [];
    drawn.bases = [];
    drawn.levelBadges = [];
    flagAnchorsRef.current.clear();
  }

  function clearLiveClansmanVisuals() {
    const drawn = drawnRef.current;
    drawn.liveClansmen.forEach(({ node, route }) => {
      route?.line.parent?.removeChild(route.line);
      route?.line.destroy();
      node.parent?.removeChild(node);
      node.destroy({ children: true });
    });
    drawn.liveClansmen = [];
  }

  function createBaseVisuals(clans: ClanDef[], isAssetLoadCancelled: () => boolean) {
    const drawn = drawnRef.current;
    const layers = layersRef.current;
    if (!layers || clans.length === 0) return;

    for (const clan of clans) {
      const zoneGfx = new Graphics();
      layers.terrainAccents.addChild(zoneGfx);
      drawn.clanZones.push({ gfx: zoneGfx, clan });
    }

    for (const clan of clans) {
      const container = new Container();
      layers.worldDynamic.addChild(container);
      const fallback = new Graphics();
      const glow = new Graphics();
      container.addChild(fallback);
      container.addChild(glow);
      container.eventMode = 'static';
      container.cursor = 'pointer';
      container.on('pointertap', (event) => {
        event.stopPropagation();
        if (selectTarget(container as SelectableTarget, clan.color)) {
          setSelectedClanId(clan.id);
        }
      });
      const entry: {
        container: Container;
        sprite: Sprite | null;
        fallback: Graphics;
        glow: Graphics;
        clan: ClanDef;
        baseY: number;
        phaseOffset: number;
        // Natural scale.y at relayout, BEFORE breathing animation. The breathing
        // tick multiplies this — without it, scale.y would clobber the
        // sprite.height=baseSize sizing and stretch the base ~3x tall.
        baseScaleY: number;
      } = {
        container,
        sprite: null,
        fallback,
        glow,
        clan,
        baseY: 0,
        phaseOffset: 0,
        baseScaleY: 1,
      };
      drawn.bases.push(entry);

      Assets.load(levelBasePng(clan.basePng, clan.level))
        .then((texture) => {
          const cancelled = isAssetLoadCancelled();
          if (cancelled || !appRef.current) return;
          const sprite = new Sprite(texture);
          sprite.anchor.set(0.5, 1);
          sprite.alpha = 0;
          container.addChildAt(sprite, Math.min(1, container.children.length));
          entry.sprite = sprite;
          relayout(WORLD_WIDTH, WORLD_HEIGHT);
        })
        .catch(() => {
          // fallback rect stays visible
        });

      loadClansmanTexture(clan.id, clan.clansmanPng)
        .then((texture) => {
          const cancelled = isAssetLoadCancelled();
          if (cancelled) return;
          clansmanTextureCache[clan.id] = texture;
          if (!DEMO_MODE) {
            // Evict markers that were drawn with the dot fallback so the next
            // sync re-creates them as sprites. The new diff-by-key sync would
            // otherwise keep the existing fallback nodes forever.
            const drawnNow = drawnRef.current;
            for (let i = drawnNow.liveClansmen.length - 1; i >= 0; i--) {
              const m = drawnNow.liveClansmen[i];
              if (!m || m.clanId !== clan.id) continue;
              m.route?.line.parent?.removeChild(m.route.line);
              m.route?.line.destroy();
              m.node.parent?.removeChild(m.node);
              m.node.destroy({ children: true });
              drawnNow.liveClansmen.splice(i, 1);
            }
            liveClansmanVisualKeyRef.current = '';
            syncLiveClansmanVisuals(() => !isMountedRef.current);
            relayout(WORLD_WIDTH, WORLD_HEIGHT);
          }
        })
        .catch(() => {
          // Travel dot fallback handles missing texture.
        });

      // Per-clan walk sprite sheet — async load + slice into 20 frame
      // Textures (4 cols × 5 rows: N/NE/E/SE/S directions × 4 frames). Once
      // ready, evict existing markers so the next sync re-creates them with
      // the AnimatedSprite-style body. Falls back silently to the
      // single-PNG `loadClansmanTexture` path above when the sheet is
      // missing or fails — markers drawn during the load gap render as the
      // legacy still sprite, then upgrade on next sync.
      //
      // Mapping of which clan gets which sheet lives in
      // ./effects/clansmanSpriteSheet.ts SHEET_PATH_BY_CLAN. Only clans
      // listed there have animated walking; others keep the single-PNG
      // textured marker.
      // Use clan.spriteSheetId (NOT clan.id) — in live mode clan.id is the
      // on-chain numeric ID and won't hit SHEET_PATH_BY_CLAN. The spriteSheetId
      // resolves to the visual asset key (clan-iron, clan-ember, ...).
      // Without this fix, live-mode clans silently fell through to the
      // legacy single-PNG marker and never gained the animated walk cycle
      // (super-swarm v2.6.0 HIGH from codex 5.5).
      if (hasClansmanSpriteSheet(clan.spriteSheetId)) {
        loadClansmanSpriteSheet(clan.spriteSheetId)
          .then(() => {
            const cancelled = isAssetLoadCancelled();
            if (cancelled || DEMO_MODE) return;
            const drawnNow = drawnRef.current;
            for (let i = drawnNow.liveClansmen.length - 1; i >= 0; i--) {
              const m = drawnNow.liveClansmen[i];
              if (!m || m.clanId !== clan.id) continue;
              m.route?.line.parent?.removeChild(m.route.line);
              m.route?.line.destroy();
              m.node.parent?.removeChild(m.node);
              m.node.destroy({ children: true });
              drawnNow.liveClansmen.splice(i, 1);
            }
            liveClansmanVisualKeyRef.current = '';
            syncLiveClansmanVisuals(() => !isMountedRef.current);
            relayout(WORLD_WIDTH, WORLD_HEIGHT);
          })
          .catch(() => {
            // Sheet load failed — keep the single-PNG fallback rendering.
          });
      }
    }

    for (const clan of clans) {
      const bg = new Graphics();
      const label = new Text({
        text: 'Lv 1',
        style: {
          fill: 0xffe9b8,
          fontSize: 12,
          fontFamily: '"Cinzel", "Times New Roman", serif',
          fontWeight: '700',
        },
      });
      label.anchor.set(0.5, 0.5);
      const base = drawn.bases.find((b) => b.clan.id === clan.id);
      if (base) base.container.addChild(bg, label);
      drawn.levelBadges.push({ bg, label, clan });
    }
  }

  function syncLiveClanVisuals(isAssetLoadCancelled: () => boolean) {
    if (DEMO_MODE) return;
    const liveClans = liveClansToVisualClans(snapshotRef.current?.clans as SnapshotClan[] | undefined);
    const key = liveClans.map((clan) => `${clan.id}:${clan.homeRegion}:${clan.level ?? 0}`).join('|');
    if (key === liveClanVisualKeyRef.current) return;
    liveClanVisualKeyRef.current = key;
    clearLiveClanVisuals();
    createBaseVisuals(liveClans, isAssetLoadCancelled);
    liveClansmanVisualKeyRef.current = '';
    syncLiveClansmanVisuals(isAssetLoadCancelled);
  }

  function extractLiveClansmen(liveClans: readonly SnapshotClan[] | undefined) {
    if (!liveClans || liveClans.length === 0) return [];
    const byClan = new Map(liveClansToVisualClans(liveClans).map((clan) => [clan.id, clan]));
    const markers: Array<Omit<LiveClansmanMarker, 'node' | 'body' | 'halo' | 'carry' | 'statusBg' | 'statusText' | 'offsetIndex'>> = [];
    for (const clan of liveClans) {
      const visual = byClan.get(clan.id);
      if (!visual || !Array.isArray(clan.clansmen)) continue;
      for (const row of clan.clansmen) {
        const derived = fieldAt(row, 'clansman') ?? row;
        const clansman = fieldAt(derived, 'clansman') ?? derived;
        const mission = fieldAt(row, 'activeMission') ?? fieldAt(derived, 'activeMission');
        const clansmanId = numberLike(fieldAt(clansman, 'clansmanId'));
        if (clansmanId <= 0) continue;
        // ClansmanState.DEAD (chain enum mirrored in shared/generated/enums.ts).
        // Dead clansmen render at their last-known region (lying down + darkened),
        // and we suppress any "active mission" hint so the sprite doesn't animate.
        const clansmanStateRaw = numberLike(fieldAt(clansman, 'state'), -1);
        const isDead = clansmanStateRaw === ClansmanState.DEAD;
        const currentRegion = numberLike(
          fieldAt(derived, 'effectiveRegion') ?? fieldAt(clansman, 'currentRegion') ?? clan.baseRegion,
          clan.baseRegion ?? 0,
        );
        const missionActive = !isDead && Boolean(fieldAt(mission, 'active'));
        const action = missionActive ? numberLike(fieldAt(mission, 'action')) : 0;
        const startRegion = missionActive ? numberLike(fieldAt(mission, 'startRegion'), currentRegion) : currentRegion;
        const targetRegion = missionActive ? numberLike(fieldAt(mission, 'targetRegion'), currentRegion) : currentRegion;
        const regionKey = REGION_KEY_BY_CHAIN_ID[missionActive ? startRegion : currentRegion] ?? visual.homeRegion;
        // Dead clansmen never have a target region — the route line should not draw.
        const targetRegionKey = isDead ? undefined : REGION_KEY_BY_CHAIN_ID[targetRegion];
        const startTick = numberLike(fieldAt(mission, 'startTick') ?? fieldAt(mission, 'submittedAtTick'));
        const arrivalTick = numberLike(fieldAt(mission, 'arrivalTick'), startTick);
        const actionStartTick = numberLike(fieldAt(mission, 'actionStartTick'), arrivalTick);
        const settlesAtTick = numberLike(fieldAt(mission, 'settlesAtTick'), actionStartTick);
        markers.push({
          key: `${clan.id}:${clansmanId}`,
          clanId: clan.id,
          spriteSheetId: visual.spriteSheetId,
          clansmanId: String(clansmanId),
          regionKey,
          targetRegionKey,
          missionActive,
          action,
          startTick,
          arrivalTick,
          actionStartTick,
          settlesAtTick,
          carryWood: resourceUnits(fieldAt(clansman, 'carryWood')),
          carryIron: resourceUnits(fieldAt(clansman, 'carryIron')),
          carryWheat: resourceUnits(fieldAt(clansman, 'carryWheat')),
          carryFish: resourceUnits(fieldAt(clansman, 'carryFish')),
          color: visual.color,
          isDead,
        });
      }
    }
    const perRegionClan = new Map<string, number>();
    return markers.map((marker) => {
      const bucket = `${marker.clanId}:${marker.regionKey}`;
      const offsetIndex = perRegionClan.get(bucket) ?? 0;
      perRegionClan.set(bucket, offsetIndex + 1);
      return { ...marker, offsetIndex };
    });
  }

  /**
   * Build the yellow "active mission" halo ring that orbits behind an alive
   * clansman marker when `missionActive` is true. Factored out so both
   * makeLiveClansmanMarker (initial allocation) and the sync loop (lazy-create
   * on dead→alive revive or idle→active transition) can use the same geometry.
   * Lazy-create is required because a clansman first seen DEAD has no halo
   * allocated; previously the dead→alive transition only flipped
   * `halo.visible`, which was a silent no-op when halo was null (issue #249).
   */
  function makeHaloGraphics(): Graphics {
    const halo = new Graphics();
    halo.circle(0, 0, 16);
    halo.stroke({ color: 0xffe6a0, width: 2, alpha: 0.95 });
    return halo;
  }

  function makeLiveClansmanMarker(color: number, clanId: string, spriteSheetId: string, missionActive: boolean, isDead: boolean) {
    const container = new Container();
    const statusBg = new Graphics();
    const statusText = new Text({
      text: '',
      style: {
        fill: 0xfff2c6,
        fontSize: 10,
        fontFamily: '"Inter", Arial, sans-serif',
        fontWeight: '800',
        stroke: { color: 0x15120d, width: 2 },
      },
    });
    statusText.anchor.set(0.5, 0.5);
    let body: Sprite | Graphics | null = null;
    // Prefer the animated walk-sheet frame when ready — gives us 4-frame
    // directional walking via updateLiveClansmanPositions. Falls back to
    // the legacy single-PNG sprite (still walk-pose), then to the dot
    // Graphics for the load-gap.
    //
    // The first frame of the S row is the starting frame because that's
    // the visual the legacy single-PNG textures were authored from
    // (front-facing, feet planted).
    //
    // Use spriteSheetId (NOT clanId) for the frame-set lookup — in live mode
    // clanId is the on-chain ID ("1", "2", ...) and won't match
    // SHEET_PATH_BY_CLAN keys (which are visual asset IDs).
    const frameSet = getClansmanFrameSet(spriteSheetId);
    let anim: ClansmanAnimState | undefined;
    if (frameSet) {
      const startTex = frameSet.rows.S[0]!;
      const sprite = new Sprite(startTex);
      sprite.anchor.set(0.5, isDead ? 0.5 : 0.82);
      // The sheet's per-frame size (≈280×280) is much bigger than the legacy
      // 64-ish px asset, so we re-scale to the same target heights the dot
      // marker used (34/42 px) to keep marker footprint identical. Width
      // tracks height via the texture aspect ratio.
      const targetH = missionActive ? 42 : 34;
      const ratio = targetH / sprite.texture.height;
      sprite.height = targetH;
      sprite.width = sprite.texture.width * ratio;
      container.addChild(sprite);
      body = sprite;
      anim = makeClansmanAnimState();
    } else {
      const tex = clansmanTextureCache[clanId];
      if (tex) {
        const sprite = new Sprite(tex);
        // Dead clansmen rotate 90° (lying down) — anchor at sprite center so the
        // rotation pivots on the body, not the feet. Live clansmen keep the
        // feet-anchor (0.5, 0.82) so they stand on their map dot.
        sprite.anchor.set(0.5, isDead ? 0.5 : 0.82);
        const targetH = missionActive ? 42 : 34;
        const ratio = targetH / sprite.texture.height;
        sprite.height = targetH;
        sprite.width = sprite.texture.width * ratio;
        container.addChild(sprite);
        body = sprite;
      } else {
        const fallback = new Graphics();
        fallback.circle(0, 0, missionActive ? 7 : 6);
        fallback.fill({ color, alpha: 1 });
        fallback.stroke({ color: 0xffffff, width: 1.5, alpha: 0.85 });
        container.addChild(fallback);
        body = fallback;
      }
    }
    let halo: Graphics | null = null;
    if (missionActive && !isDead) {
      halo = makeHaloGraphics();
      container.addChildAt(halo, 0);
    }
    applyDeadVisualState(body, isDead, clanId);
    const carry = makeCarryIndicator();
    carry.container.y = -24;
    container.addChild(carry.container);
    container.addChild(statusBg, statusText);
    container.eventMode = 'static';
    container.cursor = 'pointer';
    container.on('pointertap', (event) => {
      event.stopPropagation();
      if (selectTarget(container as SelectableTarget, color)) {
        setSelectedClanId(null);
      }
    });
    return { container, body, halo, carry, statusBg, statusText, anim };
  }

  /**
   * Resize a clansman body sprite for the current mission-active state.
   * makeLiveClansmanMarker authors the body at 42px (active) or 34px (idle)
   * tall, then the sync loop hits this helper on idle↔active transitions
   * so existing markers track the same dimorphism without a full rebuild.
   *
   * Sprite path: rescale via target-height + aspect ratio (mirrors the
   * makeLiveClansmanMarker math). Graphics fallback: redraw the circle at
   * the new radius (7 active / 6 idle) since Graphics has no .height/.width
   * the same way Sprite does.
   *
   * Without this, alive idle→active transitions on existing markers grew
   * a halo (via lazy makeHaloGraphics) but kept the smaller 34px body, so
   * a clansman who got assigned a mission visually under-sized vs one who
   * was created with missionActive=true at first sight (super-swarm v2.6.0
   * MED from codex 5.4).
   */
  function applyMissionActiveBodySize(
    body: Sprite | Graphics | null,
    color: number,
    missionActive: boolean,
  ) {
    if (!body) return;
    if ('texture' in body) {
      const sprite = body as Sprite;
      const targetH = missionActive ? 42 : 34;
      // Skip re-scale if already at target — saves a UV recompute when sync
      // fires for unrelated reasons (e.g. dead↔alive without missionActive change).
      if (Math.abs(sprite.height - targetH) < 0.5) return;
      const sourceH = sprite.texture.height;
      if (!sourceH) return;
      const ratio = targetH / sourceH;
      sprite.height = targetH;
      sprite.width = sprite.texture.width * ratio;
    } else {
      // Graphics fallback: redraw circle at new radius.
      const fallback = body as Graphics;
      fallback.clear();
      fallback.circle(0, 0, missionActive ? 7 : 6);
      fallback.fill({ color, alpha: 1 });
      fallback.stroke({ color: 0xffffff, width: 1.5, alpha: 0.85 });
    }
  }

  /**
   * Apply the "dead" pose on a clansman body — rotation 90°, darkening tint,
   * and a centered anchor so the 90° rotation pivots on the body center
   * rather than the feet. Pulled out so it can run both at marker-creation
   * time and whenever an alive→dead transition fires inside the sync loop.
   *
   * Why tint=0x808080: PixiJS multiplies the tint against the source pixels,
   * so a flat mid-grey collapses the dynamic range and reads as "shadowed"
   * without losing the silhouette. Graphics fallbacks accept the same tint
   * channel since PIXI v8.
   *
   * For the inverse transition (dead→alive), use applyAliveVisualState — it
   * restores the feet-anchor (0.5, 0.82) and clears tint/rotation/alpha.
   */
  function applyDeadVisualState(body: Sprite | Graphics | null, isDead: boolean, clanId?: string) {
    if (!body) return;
    if (isDead) {
      // Historically the walk-sheet PNGs shipped as RGB (no alpha channel),
      // so tinting one to 0x808080 painted the entire 280×280 frame rect as
      // a solid grey rectangle instead of just the figure silhouette (see
      // PR #320). Issue #325 fixed that at source — the sheets are now RGBA
      // with transparent backgrounds — but we still swap to the legacy
      // single-PNG for the dead pose: a corpse doesn't animate, the legacy
      // 48×64 texture is ~7KB vs ~1.6MB for a walk-sheet, and the swap
      // path is the established #320 contract. Keeping the swap also leaves
      // a clean fallback if a future asset re-export regresses the alpha
      // channel.
      if (clanId && 'texture' in body) {
        const legacyTex = clansmanTextureCache[clanId];
        if (legacyTex && (body as Sprite).texture !== legacyTex) {
          const sprite = body as Sprite;
          sprite.texture = legacyTex;
          // Re-establish target size against the new texture — sprite.height
          // = 34 puts scale.y = 34 / texture.height; swapping texture
          // mid-flight without this leaves scale at the walk-sheet ratio
          // (~34/280 = 0.12) applied to the 64-px legacy texture, shrinking
          // the corpse to ~8px tall.
          const targetH = 34;
          sprite.height = targetH;
          sprite.width = sprite.texture.width * (targetH / sprite.texture.height);
        }
      }
      // Anchor BEFORE rotation so the 90° flip pivots around the body
      // center, not the feet. Graphics fallback (circle drawn at origin)
      // has no .anchor — guard with `'anchor' in body`.
      if ('anchor' in body) {
        (body as Sprite).anchor.set(0.5, 0.5);
      }
      body.rotation = Math.PI / 2; // 90°, sprite lies on its side
      // Cast to any: Graphics has `tint` in pixi v8 too but the type only
      // surfaces it on Sprite; we know the runtime supports it.
      (body as Sprite).tint = 0x808080;
      body.alpha = 0.9;
    } else {
      // Backwards-compat path: callers that pass isDead=false still get the
      // alive pose, but applyAliveVisualState is the preferred entry point
      // because it makes the symmetry explicit at call-sites.
      applyAliveVisualState(body);
    }
  }

  /**
   * Apply the "alive" pose on a clansman body — feet-anchor (0.5, 0.82) so
   * the sprite stands on its map dot, rotation 0, full opacity, default
   * tint. This is the symmetric counterpart to applyDeadVisualState and is
   * what the sync-loop calls on a dead→alive (revive) transition.
   *
   * Note: the caller is responsible for restoring `halo.visible = true` on
   * the marker container — halo lives at marker level, not on `body`.
   */
  function applyAliveVisualState(body: Sprite | Graphics | null, spriteSheetId?: string) {
    if (!body) return;
    // Symmetric inverse of applyDeadVisualState's texture swap: if the body
    // currently shows the legacy single-PNG (left over from dead state) but
    // a walk-sheet frame is available, restore it here so the revived
    // clansman picks up the animation cycle again. `advanceClansmanAnimation`
    // re-assigns sprite.texture per tick once it sees motion, but the FIRST
    // frame post-revive (before any movement delta) would otherwise render
    // the legacy texture standing-up — which looks wrong against the
    // walk-sheet style.
    if (spriteSheetId && 'texture' in body) {
      const frameSet = getClansmanFrameSet(spriteSheetId);
      if (frameSet) {
        const sprite = body as Sprite;
        const startTex = frameSet.rows.S[0]!;
        if (sprite.texture !== startTex) {
          sprite.texture = startTex;
          const targetH = 34;
          sprite.height = targetH;
          sprite.width = sprite.texture.width * (targetH / sprite.texture.height);
        }
      }
    }
    if ('anchor' in body) {
      (body as Sprite).anchor.set(0.5, 0.82);
    }
    body.rotation = 0;
    (body as Sprite).tint = 0xffffff;
    body.alpha = 1;
  }

  function syncLiveClansmanVisuals(isAssetLoadCancelled: () => boolean) {
    if (DEMO_MODE || isAssetLoadCancelled()) return;
    const layers = layersRef.current;
    if (!layers) return;
    const markers = extractLiveClansmen(snapshotRef.current?.clans as SnapshotClan[] | undefined);
    const rosterKey = markers.map((marker) => marker.key).join('|');
    const drawn = drawnRef.current;
    const nextKeys = new Set(markers.map((marker) => marker.key));
    for (let i = drawn.liveClansmen.length - 1; i >= 0; i--) {
      const current = drawn.liveClansmen[i];
      if (!current || nextKeys.has(current.key)) continue;
      current.route?.line.parent?.removeChild(current.route.line);
      current.route?.line.destroy();
      current.node.parent?.removeChild(current.node);
      current.node.destroy({ children: true });
      drawn.liveClansmen.splice(i, 1);
    }
    const existingByKey = new Map(drawn.liveClansmen.map((marker) => [marker.key, marker]));
    for (const marker of markers) {
      const existing = existingByKey.get(marker.key);
      if (existing) {
        const wasDead = existing.isDead;
        const wasMissionActive = existing.missionActive;
        Object.assign(existing, marker, {
          node: existing.node,
          body: existing.body,
          halo: existing.halo,
          carry: existing.carry,
          statusBg: existing.statusBg,
          statusText: existing.statusText,
          route: existing.route,
          anim: existing.anim,
        });
        // Alive→dead (or dead→alive) transition: re-pose the body sprite
        // in place without rebuilding the node. The split between
        // applyDeadVisualState and applyAliveVisualState makes the symmetry
        // explicit — both branches MUST set anchor (centered for the dead
        // 90° rotation, feet for the standing pose) and tint/alpha/rotation,
        // otherwise an alive→dead→alive cycle leaks state.
        if (wasDead !== marker.isDead) {
          if (marker.isDead) {
            applyDeadVisualState(existing.body, true, marker.clanId);
            if (existing.halo) existing.halo.visible = false;
            if (existing.route) {
              // A corpse doesn't travel — drop the route line. We keep
              // existing.route undefined so updateLiveClansmanPositions()
              // won't try to re-draw it.
              existing.route.line.parent?.removeChild(existing.route.line);
              existing.route.line.destroy();
              existing.route = undefined;
            }
          } else {
            applyAliveVisualState(existing.body, marker.spriteSheetId);
            // Body size tracks missionActive too — a revived clansman with
            // missionActive=true needs the 42px body (not the 34px idle
            // size). Without this, the dead→alive revive restored anchor
            // / rotation / tint but kept whatever size the body had at
            // marker creation (v2.6.0 MED fix from codex 5.4).
            applyMissionActiveBodySize(existing.body, marker.color, marker.missionActive);
            // Halo lives at marker level, not on body — restore here on
            // revive. If the marker was first seen DEAD, makeLiveClansmanMarker
            // never allocated `halo` (the `if (missionActive && !isDead)` guard
            // was false), so `existing.halo` is null. Lazily create it now
            // when missionActive is true — otherwise the dead→alive transition
            // is a silent no-op and the revived clansman never grows a halo
            // (issue #249, super-swarm v2.5.0 MED from codex 5.5, codex 5.4,
            // and Opus 4.7).
            if (!existing.halo && marker.missionActive) {
              existing.halo = makeHaloGraphics();
              // addChildAt(_, 0): halo MUST sit behind the body so the
              // clansman silhouette reads on top of the ring, matching the
              // z-order makeLiveClansmanMarker uses at initial allocation.
              existing.node.addChildAt(existing.halo, 0);
            } else if (existing.halo) {
              existing.halo.visible = marker.missionActive;
            }
          }
        } else if (!marker.isDead && wasMissionActive !== marker.missionActive) {
          // Idle→active (or active→idle) transition for an ALIVE clansman:
          // same lazy-create pattern. An alive+idle clansman who just got
          // assigned a mission has no halo yet — allocate it on demand.
          // Without this, the marker has the right size/anchor but visually
          // looks idle (no orbit ring) until full re-mount. Mirrors the
          // dead→alive branch so both transitions converge on a consistent
          // visual state (issue #249, second leg).
          if (!existing.halo && marker.missionActive) {
            existing.halo = makeHaloGraphics();
            existing.node.addChildAt(existing.halo, 0);
          } else if (existing.halo) {
            existing.halo.visible = marker.missionActive;
          }
          // Body size dimorphism — 42px active / 34px idle. Without this,
          // a clansman who got assigned a mission grew a halo but kept the
          // 34px idle body (and vice versa on mission completion). The
          // sprite/Graphics distinction is handled inside the helper
          // (super-swarm v2.6.0 MED from codex 5.4).
          applyMissionActiveBodySize(existing.body, marker.color, marker.missionActive);
        }
        continue;
      }
      const { container, body, halo, carry, statusBg, statusText, anim } = makeLiveClansmanMarker(
        marker.color,
        marker.clanId,
        marker.spriteSheetId,
        marker.missionActive,
        marker.isDead,
      );
      layers.worldDynamic.addChild(container);
      drawn.liveClansmen.push({ ...marker, node: container, body, halo, carry, statusBg, statusText, anim });
    }
    liveClansmanVisualKeyRef.current = rosterKey;
    updateLiveClansmanPositions();
  }

  function currentTickFloat() {
    const clockEpoch = tickClockEpochRef.current;
    const snap = snapshotRef.current;
    const tick = clockEpoch?.tick ?? (typeof snap?.tick === 'number' && Number.isFinite(snap.tick) ? snap.tick : liveTickRef.current);
    // World-paused short-circuit (dev): freeze tick float when chain pause flag set.
    if (snap?.worldPaused === true) {
      return tick;
    }
    const epoch = clockEpoch
      ? { startedAt: clockEpoch.startedAt, durationMs: clockEpoch.durationMs }
      : snap?.tickEpoch;
    if (!epoch || typeof epoch.startedAt !== 'number' || typeof epoch.durationMs !== 'number' || epoch.durationMs <= 0) {
      return tick;
    }
    const startedAtMs = epoch.startedAt < 10_000_000_000 ? epoch.startedAt * 1000 : epoch.startedAt;
    return tick + clamp01((Date.now() - startedAtMs) / epoch.durationMs);
  }

  function projectedRegionAnchor(regionKey: string): Point2 | null {
    const region = REGIONS.find(r => r.id === regionKey);
    if (!region) return null;
    const { scaleX, scaleY, offsetX, offsetY } = layoutRef.current;
    return {
      x: offsetX + region.nx * REF_W * scaleX,
      y: offsetY + region.ny * REF_H * scaleY,
    };
  }

  // Bandit camp sits in the region's polygon at the point farthest from the
  // region-center base anchor. Current base rendering anchors every clan base
  // at clan.homeRegion's region coords; if bases gain per-clan offsets later,
  // this should use those stored base coords instead.
  function projectedBanditCampAnchor(regionKey: string): Point2 | null {
    const region = REGIONS.find(r => r.id === regionKey);
    if (!region) return null;
    const { scaleX, scaleY, offsetX, offsetY } = layoutRef.current;

    const basePositions: Array<[number, number]> = drawnRef.current.bases.some(
      entry => entry.clan.homeRegion === regionKey,
    )
      ? [[region.nx * REF_W, region.ny * REF_H]]
      : [];

    if (basePositions.length === 0) {
      return {
        x: offsetX + region.nx * REF_W * scaleX,
        y: offsetY + region.ny * REF_H * scaleY,
      };
    }

    const xs = region.polygon.map(([x]) => x);
    const ys = region.polygon.map(([, y]) => y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    // Margin keeps the camp visually inside the region rather than hugging the boundary.
    const insetX = (maxX - minX) * 0.08;
    const insetY = (maxY - minY) * 0.08;
    const sampleMinX = minX + insetX;
    const sampleMaxX = maxX - insetX;
    const sampleMinY = minY + insetY;
    const sampleMaxY = maxY - insetY;

    const STEPS = 6;
    let bestX = region.nx * REF_W;
    let bestY = region.ny * REF_H;
    let bestMinDistSq = -Infinity;
    for (let i = 0; i <= STEPS; i++) {
      for (let j = 0; j <= STEPS; j++) {
        const x = sampleMinX + ((sampleMaxX - sampleMinX) * i) / STEPS;
        const y = sampleMinY + ((sampleMaxY - sampleMinY) * j) / STEPS;
        if (!pointInPolygon(x, y, region.polygon)) continue;
        let minDistSq = Infinity;
        for (const [bx, by] of basePositions) {
          const dx = x - bx;
          const dy = y - by;
          const d = dx * dx + dy * dy;
          if (d < minDistSq) minDistSq = d;
        }
        if (minDistSq > bestMinDistSq) {
          bestMinDistSq = minDistSq;
          bestX = x;
          bestY = y;
        }
      }
    }

    return {
      x: offsetX + bestX * scaleX,
      y: offsetY + bestY * scaleY,
    };
  }

  function routeControlPoints(route: TravelRoute) {
    const from = projectedRegionAnchor(route.fromRegionKey);
    const to = projectedRegionAnchor(route.toRegionKey);
    if (!from || !to) return null;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const dist = Math.max(1, Math.hypot(dx, dy));
    const nx = -dy / dist;
    const ny = dx / dist;
    const bendSign = hashUnit(`${route.seed}:bend`) > 0.5 ? 1 : -1;
    const bendA = bendSign * Math.min(150 * layoutRef.current.scale, dist * 0.24);
    const bendB = -bendSign * Math.min(95 * layoutRef.current.scale, dist * 0.16);
    return {
      p0: from,
      p1: { x: from.x + dx * 0.32 + nx * bendA, y: from.y + dy * 0.32 + ny * bendA },
      p2: { x: from.x + dx * 0.68 + nx * bendB, y: from.y + dy * 0.68 + ny * bendB },
      p3: to,
    };
  }

  function routeProgress(route: TravelRoute, now = performance.now()) {
    return clamp01((now - route.startedAt) / route.durationMs);
  }

  function routePoint(route: TravelRoute, now = performance.now()): Point2 | null {
    const reconcile = route.reconcile;
    if (reconcile) {
      const t = clamp01((now - reconcile.startedAt) / reconcile.durationMs);
      if (t < 1) return lerpPoint(reconcile.from, reconcile.to, easeInOutQuad(t));
      route.reconcile = undefined;
    }
    const controls = routeControlPoints(route);
    if (!controls) return null;
    return cubicBezierPoint(controls.p0, controls.p1, controls.p2, controls.p3, routeProgress(route, now));
  }

  function redrawRouteLine(route: TravelRoute, now = performance.now(), alphaScale = 1) {
    const controls = routeControlPoints(route);
    route.line.clear();
    if (!controls) return;
    const progress = routeProgress(route, now);
    const alpha = 0.3 * alphaScale * (1 - clamp01((progress - 0.88) / 0.12) * 0.65);
    route.line.moveTo(controls.p0.x, controls.p0.y);
    for (let i = 1; i <= 28; i++) {
      const p = cubicBezierPoint(controls.p0, controls.p1, controls.p2, controls.p3, i / 28);
      route.line.lineTo(p.x, p.y);
    }
    route.line.stroke({ color: route.color, width: Math.max(1.5, 2.5 * layoutRef.current.scale), alpha });
  }

  function makeRoute(fromRegionKey: string, toRegionKey: string, color: number, seed: string): TravelRoute {
    const line = new Graphics();
    line.alpha = 1;
    line.zIndex = -1;
    return {
      fromRegionKey,
      toRegionKey,
      startedAt: performance.now(),
      durationMs: OPTIMISTIC_TRAVEL_MS,
      seed,
      color,
      line,
    };
  }

  function regionWanderPoint(regionKey: string, marker: LiveClansmanMarker, phase = 0) {
    const region = REGIONS.find(r => r.id === regionKey);
    const { scaleX, scaleY, offsetX, offsetY } = layoutRef.current;
    if (!region) return null;
    const point = polygonWanderPoint(region, marker, phase);
    if (!point) return null;
    const drift = marker.missionActive ? Math.sin(performance.now() / 900 + marker.offsetIndex) * 0.04 : 0;
    const area = REGION_VISUAL_AREAS[regionKey] ?? { rx: 80, ry: 50 };
    return {
      x: offsetX + (point.x + Math.cos(drift) * area.rx * 0.04) * scaleX,
      y: offsetY + (point.y + Math.sin(drift) * area.ry * 0.04) * scaleY,
    };
  }

  function carryReadout(marker: LiveClansmanMarker, tickFloat: number) {
    const options = [
      { amount: marker.carryWood, cap: WOOD_CAP, label: 'wood', action: marker.action === 1 },
      { amount: marker.carryIron, cap: IRON_CAP, label: 'iron', action: marker.action === 2 },
      { amount: marker.carryWheat, cap: WHEAT_CAP, label: 'wheat', action: marker.action === 5 },
      { amount: marker.carryFish, cap: FISH_CAP, label: 'fish', action: marker.action === 3 || marker.action === 4 },
    ];
    const totalCarry = options.reduce((sum, option) => sum + option.amount, 0);
    const isWorking =
      marker.missionActive
      && tickFloat >= marker.actionStartTick
      && (marker.settlesAtTick === 0 || tickFloat < marker.settlesAtTick);
    if (!isWorking && totalCarry <= 0) return { text: '', fill: 0, visible: false };
    const selected =
      options.find((option) => option.action)
      ?? options.reduce((best, option) => (option.amount > best.amount ? option : best), options[0]!);
    return {
      text: `${selected.amount}/${selected.cap} ${selected.label}`,
      fill: selected.cap > 0 ? clamp01(selected.amount / selected.cap) : 0,
      visible: true,
    };
  }

  function statusTextForMarker(marker: LiveClansmanMarker, tickFloat: number) {
    if (!marker.missionActive) return '';
    if (marker.settlesAtTick > 0 && tickFloat >= marker.settlesAtTick) return '';
    if (
      marker.targetRegionKey
      && marker.targetRegionKey !== marker.regionKey
      && (!marker.route || routeProgress(marker.route) < 1)
    ) {
      return `traveling to ${regionDisplayName(marker.targetRegionKey)}`;
    }
    if (marker.arrivalTick > marker.startTick && tickFloat < marker.arrivalTick) {
      return `traveling to ${regionDisplayName(marker.targetRegionKey)}`;
    }
    if (marker.action === 13) return '';
    return actionVerb(marker.action);
  }

  function redrawWorkerStatus(marker: LiveClansmanMarker, tickFloat: number) {
    const status = statusTextForMarker(marker, tickFloat);
    marker.statusText.text = status;
    marker.statusBg.clear();
    if (!status) {
      marker.statusText.alpha = 0;
      return;
    }
    marker.statusText.alpha = 1;
    marker.statusText.style.fontSize = Math.max(9, Math.round(10 * layoutRef.current.scale));
    marker.statusText.x = 0;
    marker.statusText.y = -52;
    const padX = 7;
    const padY = 4;
    const w = Math.max(48, marker.statusText.width + padX * 2);
    const h = marker.statusText.height + padY * 2;
    marker.statusBg.roundRect(-w / 2, marker.statusText.y - h / 2, w, h, 7);
    marker.statusBg.fill({ color: 0x16130d, alpha: 0.84 });
    marker.statusBg.stroke({ color: marker.color, width: 1.4, alpha: 0.95 });
  }

  function ensureLiveRoute(marker: LiveClansmanMarker, currentPosition: Point2, toRegionKey: string) {
    const layers = layersRef.current;
    if (!layers) return null;
    if (
      marker.route
      && !marker.route.clearing
      && marker.route.fromRegionKey === marker.regionKey
      && marker.route.toRegionKey === toRegionKey
    ) {
      return marker.route;
    }

    const destination = projectedRegionAnchor(toRegionKey);
    if (!destination) return null;
    const previousProgress = marker.route ? routeProgress(marker.route) : 0;
    marker.route?.line.parent?.removeChild(marker.route.line);
    marker.route?.line.destroy();
    const route = makeRoute(marker.regionKey, toRegionKey, marker.color, marker.key);
    route.startedAt = performance.now() - previousProgress * route.durationMs;
    route.reconcile = {
      startedAt: performance.now(),
      durationMs: TRAVEL_RECONCILE_MS,
      from: currentPosition,
      to: routePoint(route) ?? destination,
    };
    const markerIndex = marker.node.parent === layers.worldDynamic ? layers.worldDynamic.getChildIndex(marker.node) : 0;
    layers.worldDynamic.addChildAt(route.line, Math.max(0, markerIndex));
    marker.route = route;
    return route;
  }

  function clearLiveRoute(marker: LiveClansmanMarker, currentPosition: Point2, destination: Point2) {
    const route = marker.route;
    if (!route) return;
    if (route.clearing) return;
    route.clearing = true;
    route.reconcile = {
      startedAt: performance.now(),
      durationMs: TRAVEL_RECONCILE_MS,
      from: currentPosition,
      to: destination,
    };
    window.setTimeout(() => {
      if (marker.route !== route) return;
      route.line.parent?.removeChild(route.line);
      route.line.destroy();
      marker.route = undefined;
    }, TRAVEL_RECONCILE_MS);
  }

  /**
   * Drive the per-marker walking animation. Called at the end of every
   * updateLiveClansmanPositions iteration after the body position has been
   * assigned.
   *
   * - Direction is derived from (lastX, lastY) → (currentX, currentY) so it
   *   reflects ACTUAL motion (route segment heading, etc.)
   * - The walk-vs-freeze decision uses the explicit `isMoving` flag passed
   *   in by the caller (= mission-active + targetRegionKey != regionKey).
   *   Using the position-delta threshold (WALK_EPSILON_PX) here was buggy:
   *   the decorative idle bob (±1.2px) exceeded the 0.05px threshold and
   *   caused idle clansmen to flicker through the walk cycle. Semantic
   *   intent is the source of truth (super-swarm v2.6.0 MED from codex 5.4
   *   + codex 5.5 consensus).
   * - When isMoving=true, advance frame at WALK_FRAME_MS cadence using real
   *   wall-clock dt so the animation stays smooth even if the position
   *   update fires unevenly
   * - For mirrored directions (NW, W, SW) reuse the E-side textures and
   *   set sprite.scale.x to the negative current magnitude
   * - Dead markers freeze on whatever frame they were on — caller's
   *   isDead branch handles that case before reaching here.
   */
  function advanceClansmanAnimation(
    marker: LiveClansmanMarker,
    currentX: number,
    currentY: number,
    isMoving: boolean,
  ) {
    const anim = marker.anim;
    if (!anim) return;
    const body = marker.body;
    if (!body || !('texture' in body)) return; // Graphics fallback has no .texture
    const sprite = body as Sprite;
    // Frame-set is cached by visual asset ID — use spriteSheetId, not clanId
    // (in live mode, clanId is the chain ID and won't match cache keys).
    const frameSet = getClansmanFrameSet(marker.spriteSheetId);
    if (!frameSet) return;

    const now = performance.now();
    let dx = 0;
    let dy = 0;
    if (anim.lastX !== null && anim.lastY !== null) {
      dx = currentX - anim.lastX;
      dy = currentY - anim.lastY;
    }
    // Direction still derives from observed motion (so left vs right vs N/S
    // matches the actual segment heading), but only when there's enough
    // delta to avoid bob-jitter rotating the sprite. WALK_EPSILON_PX is
    // re-purposed: was the walk/freeze gate, now just a direction-update
    // gate. When isMoving but dx/dy is tiny (e.g. first frame post-resume,
    // pause-at-waypoint), the held direction carries through.
    const distSq = dx * dx + dy * dy;
    const hasDirectionalMotion = distSq >= WALK_EPSILON_PX * WALK_EPSILON_PX;

    if (isMoving) {
      // Only update direction when there's enough delta — otherwise the
      // last-known direction holds (avoids re-snapping to S on a near-zero
      // bezier tangent).
      if (hasDirectionalMotion) {
        anim.direction = directionForVector(dx, dy);
      }
      const dt = now - anim.lastTickMs;
      anim.frameAccumMs += dt;
      // Multi-frame catch-up: if a position update was skipped (tab
      // backgrounded, frame coalescing) advance the cycle accordingly so
      // the walk doesn't "snap" on resume.
      while (anim.frameAccumMs >= WALK_FRAME_MS) {
        anim.frame = (anim.frame + 1) % 4;
        anim.frameAccumMs -= WALK_FRAME_MS;
      }
      anim.wasWalking = true;
    } else {
      // Idle: pause on frame 0 of the held direction, reset frame timer so
      // the next walk segment starts cleanly on frame 0 → 1 → 2 → 3.
      anim.frame = 0;
      anim.frameAccumMs = 0;
      anim.wasWalking = false;
    }
    anim.lastTickMs = now;
    anim.lastX = currentX;
    anim.lastY = currentY;

    const lookup = framesForDirection(frameSet, anim.direction);
    const tex = lookup.frames[anim.frame] ?? lookup.frames[0]!;
    if (sprite.texture !== tex) {
      sprite.texture = tex;
    }
    // Mirror flip for NW / W / SW. Preserve the magnitude of the current
    // X-scale (which carries the marker-level size from
    // makeLiveClansmanMarker → sprite.height/width). Pixi multiplies
    // container.scale on top, so a per-sprite mirror is safe.
    const xMag = Math.abs(sprite.scale.x) || 1;
    sprite.scale.x = lookup.mirror ? -xMag : xMag;
  }

  function updateLiveClansmanPositions() {
    const drawn = drawnRef.current;
    if (drawn.liveClansmen.length === 0) return;
    const tickFloat = currentTickFloat();
    // Focus mode (base-click): selected clan stays bright; other clans dim.
    // Same constants as applyClanFocus() so the per-frame value matches the
    // one-shot value set on selection — prevents the per-frame loop from
    // clobbering the dim back to 1 (Liam 2026-05-12).
    const focusClanId = selectedClanIdRef.current;
    for (const marker of drawn.liveClansmen) {
      const isOtherClan = !!focusClanId && marker.clanId !== focusClanId;
      const focusAlpha = isOtherClan ? 0.18 : 1;
      const from = regionWanderPoint(marker.regionKey, marker, 0);
      if (!from) continue;
      // Dead clansmen freeze at their last-known wander point — no bob, no
      // route line, no carry/status overlay. The body sprite is already
      // rotated 90° + darkened via applyDeadVisualState at create time.
      if (marker.isDead) {
        marker.node.x = from.x;
        marker.node.y = from.y;
        marker.node.zIndex = Math.round(marker.node.y + 8);
        // Container alpha is normally 1 (body's own alpha dims the sprite).
        // During focus mode, dead-OTHER-clan clansmen also dim — the focus
        // dim multiplies onto the existing dead-body alpha (PR #244) so
        // dead+other-clan reads as even more faded than alive+other-clan.
        marker.node.alpha = focusAlpha;
        marker.node.scale.set(Math.max(0.95, layoutRef.current.scale * 1.08));
        marker.carry.label.text = '';
        marker.carry.targetFill = 0;
        marker.carry.displayedFill = 0;
        redrawCarryIndicator(marker.carry);
        marker.statusText.text = '';
        marker.statusText.alpha = 0;
        marker.statusBg.clear();
        // Dead-state animation freeze: keep anim.lastX/Y in sync with the
        // current position so the next dead→alive revive doesn't see a
        // huge phantom delta and start an erroneous walk-cycle. Do NOT
        // advance frame — body sprite stays on whatever texture was set
        // last frame, plus the 90° rotation + grey tint applied at
        // applyDeadVisualState time. Skipping advanceClansmanAnimation
        // here is what "freezes on current frame" actually means.
        if (marker.anim) {
          marker.anim.lastX = from.x;
          marker.anim.lastY = from.y;
          marker.anim.frameAccumMs = 0;
          marker.anim.wasWalking = false;
          marker.anim.lastTickMs = performance.now();
        }
        continue;
      }
      const isTraveling = marker.missionActive && marker.targetRegionKey && marker.targetRegionKey !== marker.regionKey;
      let position: Point2 = from;
      if (isTraveling && marker.targetRegionKey) {
        const currentPosition = { x: marker.node.x || from.x, y: marker.node.y || from.y };
        const route = ensureLiveRoute(marker, currentPosition, marker.targetRegionKey);
        if (route) {
          redrawRouteLine(route);
          position = routePoint(route) ?? from;
        }
      } else {
        if (marker.route) {
          clearLiveRoute(marker, { x: marker.node.x || from.x, y: marker.node.y || from.y }, from);
          redrawRouteLine(marker.route, performance.now(), marker.route.clearing ? 0.35 : 1);
          position = routePoint(marker.route) ?? from;
        } else {
          const bob = Math.sin(performance.now() / 320 + marker.offsetIndex * 1.7) * 1.2;
          position = { x: from.x, y: from.y + bob };
        }
      }
      marker.node.x = position.x;
      marker.node.y = position.y;
      marker.node.zIndex = Math.round(marker.node.y + 8);
      marker.node.alpha = focusAlpha;
      // Route line follows the same focus-dim rule. applyClanFocus() sets
      // this once on selection, but routes can be created/destroyed
      // dynamically per travel — re-apply per frame so new routes also dim.
      if (marker.route) marker.route.line.alpha = isOtherClan ? 0.12 : 1;
      marker.node.scale.set(Math.max(0.95, layoutRef.current.scale * 1.08));
      const carry = carryReadout(marker, tickFloat);
      marker.carry.label.text = carry.text;
      marker.carry.targetFill = carry.fill;
      if (!carry.visible) marker.carry.displayedFill = 0;
      else marker.carry.displayedFill += (marker.carry.targetFill - marker.carry.displayedFill) * 0.18;
      redrawCarryIndicator(marker.carry);
      redrawWorkerStatus(marker, tickFloat);
      // Drive walking animation last — needs the current screen position
      // (post-route/bob) to derive movement direction. The walk/freeze
      // decision uses isTraveling (semantic intent) so the idle bob
      // doesn't accidentally trigger the walk cycle (v2.6.0 fix).
      advanceClansmanAnimation(marker, position.x, position.y, Boolean(isTraveling));
    }
  }

  function createBanditVisuals(isAssetLoadCancelled: () => boolean) {
    const drawn = drawnRef.current;
    const layers = layersRef.current;
    if (!layers) return;

    const attachBanditPointer = (target: SelectableTarget) => {
      target.eventMode = 'static';
      target.cursor = 'pointer';
      target.on('pointertap', (event) => {
        event.stopPropagation();
        selectTarget(target, 0xffe9b8);
        setSelectedClanId(null);
      });
    };

    if (DEMO_MODE && !drawn.banditIcon && !drawn.banditCountdown) {
      // Bandit indicator (style/bandit-archetype-sprites): stylized hooded silhouette.
      // Pixi loads /sprites/bandit.png async; we keep a Graphics fallback (red ring + "!")
      // visible during the load and as a safety net if the asset 404s.
      const banditIcon = new Graphics();
      attachBanditPointer(banditIcon as SelectableTarget);
      layers.worldDynamic.addChild(banditIcon);
      const countdown = new Text({
        text: '',
        style: { fill: 0xffe9b8, fontSize: 11, fontFamily: 'monospace', fontWeight: 'bold' },
      });
      countdown.anchor.set(0, 0.5);
      layers.inWorldEffects.addChild(countdown);
      drawn.banditIcon = banditIcon;
      drawn.banditCountdown = countdown;

      Assets.load(BANDIT_ANIMATION_META.fallbackAsset)
        .then((texture) => {
          const cancelled = isAssetLoadCancelled();
          if (cancelled || !appRef.current) return;
          const sprite = new Sprite(texture);
          sprite.anchor.set(0.5, 0.5);
          sprite.alpha = 0;
          attachBanditPointer(sprite as SelectableTarget);
          layers.worldDynamic.addChild(sprite);
          drawn.banditSprite = sprite;
          if (combatVignetteRef.current) return;
          redrawBandit();
        })
        .catch(() => {
          // Keep fallback ring visible.
        });
    }

    // Load the new bandit animation kit (4-frame walks NE/SE, 3-frame death,
    // optional camp). Asset failures fall back to the legacy bandit.png path
    // so the world still renders something.
    void loadBanditAnimAssets(isAssetLoadCancelled, attachBanditPointer);
  }

  // Asset prep: load all per-frame walk + death sprites for the phase machine.
  // NW/SW directions are derived at runtime via sprite.scale.x = -1.
  // Camp (bandit_camp.png) is opportunistic — if missing, we fall back to
  // /sprites/bandit.png so camp_idle still renders.
  async function loadBanditAnimAssets(
    isAssetLoadCancelled: () => boolean,
    attachBanditPointer: (target: SelectableTarget) => void,
  ) {
    const layers = layersRef.current;
    if (!layers) return;
    const animState = banditAnimRef.current;
    if (animState.assetsReady || animState.isLoading) return;
    animState.isLoading = true;

    try {
      const walkNePaths = [0, 1, 2, 3].map(i => `/sprites/bandit_walking_ne_${i}.png`);
      const walkSePaths = [0, 1, 2, 3].map(i => `/sprites/bandit_walking_se_${i}.png`);
      const deathPaths = [0, 1, 2].map(i => `/sprites/bandit_death_${i}.png`);

      const tryLoad = async (path: string) => {
        try {
          return await Assets.load(path);
        } catch {
          return null;
        }
      };

      const [neTex, seTex, deathTex, campTex] = await Promise.all([
        Promise.all(walkNePaths.map(tryLoad)),
        Promise.all(walkSePaths.map(tryLoad)),
        Promise.all(deathPaths.map(tryLoad)),
        tryLoad('/sprites/bandit_camp.png').then(t => t ?? tryLoad('/sprites/bandit.png')),
      ]);

      if (isAssetLoadCancelled() || !appRef.current) return;

      const neFiltered = neTex.filter(Boolean) as import('pixi.js').Texture[];
      const seFiltered = seTex.filter(Boolean) as import('pixi.js').Texture[];
      const deathFiltered = deathTex.filter(Boolean) as import('pixi.js').Texture[];

      if (neFiltered.length === 0 && seFiltered.length === 0) {
        // No sprite sheets loaded; phase machine stays disabled.
        return;
      }

      const animContainer = banditAnimRef.current;
      animContainer.walkTextures = { ne: neFiltered, se: seFiltered };
      animContainer.deathTextures = deathFiltered;
      animContainer.campTexture = campTex ?? null;

      // Camp sprite + optional glow.
      if (campTex) {
        const campSprite = new Sprite(campTex);
        campSprite.anchor.set(0.5, 0.85); // anchor near base of tents
        campSprite.visible = false;
        attachBanditPointer(campSprite as SelectableTarget);
        layers.worldDynamic.addChild(campSprite);
        animContainer.campSprite = campSprite;
      }
      const glow = new Graphics();
      glow.alpha = 0;
      layers.worldDynamic.addChild(glow);
      animContainer.campGlow = glow;

      // Pre-create 3 walker sprites + 3 death sprites (max active bandits = 3 per spec).
      // Each gets a red-tinted, blurred "glow" sprite behind it so the bandit
      // silhouette pops against the map background. The glow is the SAME sprite
      // (same texture/scale/flip), tinted 0xff2222 with a BlurFilter applied
      // (PixiJS v8 ships BlurFilter; pixi-filters' GlowFilter isn't in the
      // dep tree, but blur+tint+layering produces an equivalent halo).
      const makeGlow = (tex: import('pixi.js').Texture) => {
        const glow = new Sprite(tex);
        glow.anchor.set(0.5, 0.85);
        glow.tint = 0xff2222;
        glow.alpha = 0.7;
        glow.visible = false;
        glow.filters = [new BlurFilter({ strength: 6, quality: 2 })];
        return glow;
      };

      const walkBaseTex = seFiltered[0] ?? neFiltered[0];
      if (walkBaseTex) {
        for (let i = 0; i < 3; i++) {
          // Glow added FIRST so it sits behind the walker in worldDynamic's
          // sortable z-order (we also set zIndex = walker.zIndex - 1 each frame).
          const glow = makeGlow(walkBaseTex);
          layers.worldDynamic.addChild(glow);
          animContainer.walkerGlows.push(glow);

          const walker = new Sprite(walkBaseTex);
          walker.anchor.set(0.5, 0.85);
          walker.visible = false;
          attachBanditPointer(walker as SelectableTarget);
          layers.worldDynamic.addChild(walker);
          animContainer.walkers.push(walker);
        }
      }
      if (deathFiltered.length > 0) {
        const deathBase = deathFiltered[0]!;
        for (let i = 0; i < 3; i++) {
          const glow = makeGlow(deathBase);
          layers.worldDynamic.addChild(glow);
          animContainer.deathGlows.push(glow);

          const dead = new Sprite(deathBase);
          dead.anchor.set(0.5, 0.85);
          dead.visible = false;
          layers.worldDynamic.addChild(dead);
          animContainer.deathSprites.push(dead);
        }
      }

      animContainer.assetsReady = true;
    } finally {
      animState.isLoading = false;
    }
  }

  // Pick walking direction texture set + horizontal flip for NW/SW.
  function pickWalkDirection(from: { x: number; y: number }, to: { x: number; y: number }) {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    // Up-ish vs down-ish based on dy.
    const goingUp = dy < 0;
    const goingRight = dx >= 0;
    if (goingUp) {
      // NE textures cover going up-right; flip for NW (up-left).
      return { textures: 'ne' as const, flipX: !goingRight };
    }
    // SE textures cover going down-right; flip for SW (down-left).
    return { textures: 'se' as const, flipX: !goingRight };
  }

  // Apply scale + frame to a walker sprite.
  function applyWalkerFrame(
    walker: Sprite,
    textures: import('pixi.js').Texture[],
    frameIdx: number,
    flipX: boolean,
    scale: number,
  ) {
    if (textures.length === 0) return;
    const t = textures[frameIdx % textures.length] ?? textures[0]!;
    walker.texture = t;
    walker.scale.set(flipX ? -scale : scale, scale);
  }

  // Apply death frame index to a sprite.
  function applyDeathFrame(sprite: Sprite, textures: import('pixi.js').Texture[], frameIdx: number, scale: number) {
    if (textures.length === 0) return;
    const idx = Math.min(textures.length - 1, Math.max(0, frameIdx));
    const t = textures[idx] ?? textures[0]!;
    sprite.texture = t;
    sprite.scale.set(scale, scale);
  }

  // Mirror every walker → walkerGlow (red blurred halo) and every death sprite
  // → deathGlow. Called after each render frame so the glow tracks position/
  // texture/scale/visibility without each render branch needing to know about it.
  function syncBanditGlows() {
    const animState = banditAnimRef.current;
    const syncPair = (src: Sprite, glow: Sprite | undefined) => {
      if (!glow) return;
      glow.visible = src.visible;
      if (!src.visible) return;
      glow.texture = src.texture;
      // Slight upscale (1.15x) so the halo bleeds past the sprite silhouette;
      // preserve flipX via sign of scale.x.
      glow.scale.set(src.scale.x * 1.15, src.scale.y * 1.15);
      glow.x = src.x;
      glow.y = src.y;
      // Halo sits one z below the actual sprite so the sprite remains crisp.
      glow.zIndex = src.zIndex - 1;
      glow.alpha = src.alpha * 0.7;
    };
    animState.walkers.forEach((w, i) => syncPair(w, animState.walkerGlows[i]));
    animState.deathSprites.forEach((d, i) => syncPair(d, animState.deathGlows[i]));
  }

  // Render dispatch — called from the bandit-anim ticker every frame.
  function updateBanditAnimation() {
    try {
      updateBanditAnimationInner();
    } finally {
      // Always mirror walker / death sprites onto their red-glow halos AFTER
      // the per-phase render has finalized x/y/texture/scale/visibility.
      // Wrapping in try/finally guarantees the halos stay in lock-step even
      // when an inner branch early-returns (which is the dominant pattern).
      syncBanditGlows();
    }
  }

  function updateBanditAnimationInner() {
    const animState = banditAnimRef.current;
    if (!animState.assetsReady) return;

    const hideBanditAnimSprites = () => {
      if (animState.campSprite) animState.campSprite.visible = false;
      if (animState.campGlow) animState.campGlow.alpha = 0;
      animState.walkers.forEach(w => { w.visible = false; });
      animState.deathSprites.forEach(d => { d.visible = false; });
      animState.walkerGlows.forEach(g => { g.visible = false; });
      animState.deathGlows.forEach(g => { g.visible = false; });
    };

    // Yield to the existing combat vignette (DEMO mode) so we don't double-render.
    if (combatVignetteRef.current) {
      hideBanditAnimSprites();
      return;
    }

    // DEMO_MODE keeps the legacy redrawBandit + combat-vignette path intact;
    // the new phase machine activates only with a live snapshot.
    if (DEMO_MODE) {
      hideBanditAnimSprites();
      return;
    }

    const snap = snapshotRef.current;
    const tickFloat = currentTickFloat();
    const liveBanditTyped = (snap?.bandit ?? null) as SnapshotBandit | null;
    const phase = computeBanditAnimPhase(
      liveBanditTyped,
      lastBanditOutcomeRef.current,
      tickFloat,
      REGION_KEY_BY_CHAIN_ID,
    );

    const worldPaused = snap?.worldPaused === true;

    // Hide everything by default, then enable per-phase.
    hideBanditAnimSprites();

    if (phase.kind === 'hidden') {
      return;
    }

    const now = Date.now();
    const renderNow = worldPaused ? tickClockRef.current.seenAtMs : now;
    const walkFrameIdx = Math.floor(renderNow / BANDIT_WALK_FRAME_MS) % 4;
    const layoutScale = layoutRef.current.scale;
    const banditScale = BANDIT_SPRITE_SCALE * layoutScale;
    const deathScale = BANDIT_SPRITE_DEATH_SCALE * layoutScale;

    if (phase.kind === 'camp_idle') {
      const anchor = projectedBanditCampAnchor(phase.regionKey);
      if (!anchor) return;
      if (animState.campSprite) {
        animState.campSprite.visible = true;
        animState.campSprite.x = anchor.x;
        animState.campSprite.y = anchor.y;
        animState.campSprite.scale.set(banditScale * 1.6); // camp is bigger than a single bandit
        animState.campSprite.zIndex = Math.round(anchor.y);
      }
      if (animState.campGlow) {
        animState.campGlow.clear();
        animState.campGlow.circle(anchor.x, anchor.y - 6 * layoutScale, 28 * layoutScale);
        animState.campGlow.fill({ color: 0xcc1122, alpha: 0.55 });
        animState.campGlow.alpha = phase.glowAlpha * 0.85;
        animState.campGlow.zIndex = Math.round(anchor.y) - 1;
      }
      return;
    }

    if (phase.kind === 'camp_telegraph') {
      const anchor = projectedBanditCampAnchor(phase.regionKey);
      if (!anchor) return;
      // Three standing bandits with phase-offset jitter (sin ±1px).
      const standTextures = animState.walkTextures.se.length > 0
        ? animState.walkTextures.se
        : animState.walkTextures.ne;
      animState.walkers.forEach((walker, i) => {
        if (i >= 3) return;
        walker.visible = true;
        const offsetX = (i - 1) * 18 * layoutScale; // -18, 0, +18
        const jitter = worldPaused ? 0 : Math.sin(renderNow / 240 + i * 1.3) * 1.5;
        walker.x = anchor.x + offsetX;
        walker.y = anchor.y + jitter;
        walker.zIndex = Math.round(anchor.y);
        applyWalkerFrame(walker, standTextures, 0, false, banditScale);
      });
      // Camp glow holds at peak during telegraph — brief crossfade out.
      if (animState.campGlow) {
        animState.campGlow.clear();
        animState.campGlow.circle(anchor.x, anchor.y - 6 * layoutScale, 28 * layoutScale);
        animState.campGlow.fill({ color: 0xcc1122, alpha: 0.55 });
        animState.campGlow.alpha = (1 - phase.telegraphProgress) * 0.85;
        animState.campGlow.zIndex = Math.round(anchor.y) - 1;
      }
      return;
    }

    if (phase.kind === 'battle') {
      renderBattlePhase(phase, walkFrameIdx, banditScale, deathScale, renderNow);
      return;
    }

    if (phase.kind === 'no_battle_advance') {
      const from = projectedBanditCampAnchor(phase.fromRegionKey);
      const to = projectedBanditCampAnchor(phase.toRegionKey);
      if (!from || !to) return;
      const dir = pickWalkDirection(from, to);
      const dirTextures = animState.walkTextures[dir.textures];
      animState.walkers.forEach((walker, i) => {
        if (i >= 3) return;
        walker.visible = true;
        const t = phase.traversalT;
        const lateral = (i - 1) * 14 * layoutScale;
        walker.x = lerp(from.x, to.x, t) + lateral * (1 - t);
        walker.y = lerp(from.y, to.y, t);
        walker.zIndex = Math.round(walker.y);
        applyWalkerFrame(walker, dirTextures, walkFrameIdx + i, dir.flipX, banditScale);
      });
      return;
    }

  }

  // Battle phase — common opening (march + circle + flash) then outcome branch.
  function renderBattlePhase(
    phase: { kind: 'battle'; regionKey: string; targetClanId: string | null; outcome: BanditDiffOutcome; battleT: number },
    walkFrameIdx: number,
    banditScale: number,
    deathScale: number,
    renderNow: number,
  ) {
    const animState = banditAnimRef.current;
    const drawn = drawnRef.current;
    const fromAnchor = projectedBanditCampAnchor(phase.regionKey);
    if (!fromAnchor) return;

    // Locate the old-region target base. Won outcomes still battle at the
    // defeated base before walking to the destination region. Both 'defeated'
    // and 'won' outcomes now carry targetClanId, so we anchor the circle to
    // the actual rendered base sprite's world coords (was: stale fromAnchor
    // offset that landed in an empty patch of map).
    let targetCenter: { x: number; y: number } | null = null;
    const targetClanId =
      phase.outcome.type === 'won' || phase.outcome.type === 'defeated'
        ? phase.outcome.targetClanId
        : phase.targetClanId;
    const layoutScale = layoutRef.current.scale;
    if (targetClanId) {
      const targetClanNum = Number(targetClanId);
      const targetBase = drawn.bases.find(b => b.clan.homeRegion === phase.regionKey && b.clan.id === targetClanId)
        ?? drawn.bases.find(b => (
          b.clan.homeRegion === phase.regionKey
          && Number.isFinite(targetClanNum)
          && Number(b.clan.id) === targetClanNum
        ))
        ?? drawn.bases.find(b => b.clan.id === targetClanId);
      if (targetBase) {
        // Use the rendered base sprite's world coords (container.x/y is set in
        // the relayout pass), offset slightly upward so the orbit reads as
        // "circling above the base" rather than overlapping it.
        targetCenter = { x: targetBase.container.x, y: targetBase.container.y - 30 * layoutScale };
      }
    }
    if (!targetCenter) {
      // Fallback: the region's projected geographic anchor — a NEUTRAL anchor,
      // NOT an arbitrary same-region base. v2.5.0 had a "pick any base in
      // bandit's region" fallback here (issue #248); in a multi-clan region
      // that picked the WRONG clan's base when targetClanId was missing,
      // visually attributing the attack to a clan that wasn't actually under
      // siege (e.g. bandits circling a surviving clan = false game state).
      // The neutral region anchor reads as "battle is happening somewhere in
      // this region" without falsely indicting a specific surviving clan.
      const regionAnchor = projectedRegionAnchor(phase.regionKey);
      targetCenter = regionAnchor ?? { x: fromAnchor.x, y: fromAnchor.y };
    }

    const t = phase.battleT;
    const dir = pickWalkDirection(fromAnchor, targetCenter);
    const dirTextures = animState.walkTextures[dir.textures];

    // 0–7s: march toward target.
    if (t < BATTLE_T_MARCH_END) {
      const marchT = clamp01(t / BATTLE_T_MARCH_END);
      animState.walkers.forEach((walker, i) => {
        if (i >= 3) return;
        walker.visible = true;
        walker.alpha = 1;
        const lateral = (i - 1) * 14 * layoutScale;
        walker.x = lerp(fromAnchor.x, targetCenter!.x, easeInOutQuad(marchT)) + lateral * (1 - marchT);
        walker.y = lerp(fromAnchor.y, targetCenter!.y, easeInOutQuad(marchT));
        walker.zIndex = Math.round(walker.y);
        applyWalkerFrame(walker, dirTextures, walkFrameIdx + i, dir.flipX, banditScale);
      });
      return;
    }

    // 7–14.5s: circle + accelerate (whirlwind).
    if (t < BATTLE_T_CIRCLE_END) {
      const circleT = clamp01((t - BATTLE_T_MARCH_END) / (BATTLE_T_CIRCLE_END - BATTLE_T_MARCH_END));
      // +50% diameter (was 38 → 57) for visibility — Liam UAT 2026-05-11.
      const radius = 57 * layoutScale * (1 - circleT * 0.4);
      const angSpeed = 1.6 + circleT * 4.2; // radians/sec
      const baseAng = renderNow * 0.001 * angSpeed;
      animState.walkers.forEach((walker, i) => {
        if (i >= 3) return;
        walker.visible = true;
        walker.alpha = 1;
        const ang = baseAng + (i * Math.PI * 2 / 3);
        walker.x = targetCenter!.x + Math.cos(ang) * radius;
        walker.y = targetCenter!.y + Math.sin(ang) * radius * 0.55;
        walker.zIndex = Math.round(walker.y);
        // Direction flips as they orbit — quick pick based on tangent.
        const tangentX = -Math.sin(ang);
        const tangentDir = pickWalkDirection({ x: 0, y: 0 }, { x: tangentX, y: -1 });
        const orbitTextures = animState.walkTextures[tangentDir.textures];
        applyWalkerFrame(walker, orbitTextures, walkFrameIdx + i, tangentDir.flipX, banditScale);
      });
      return;
    }

    // 14.5–15.5s: flash + launch impulse.
    if (t < BATTLE_T_FLASH_END) {
      const flashT = clamp01((t - BATTLE_T_CIRCLE_END) / (BATTLE_T_FLASH_END - BATTLE_T_CIRCLE_END));
      const launchT = Math.max(0, (flashT - 0.5) * 2);
      const launchDist = 60 * layoutScale * launchT;
      animState.walkers.forEach((walker, i) => {
        if (i >= 3) return;
        walker.visible = true;
        walker.alpha = 1;
        const ang = (i * Math.PI * 2 / 3);
        walker.x = targetCenter!.x + Math.cos(ang) * launchDist;
        walker.y = targetCenter!.y + Math.sin(ang) * launchDist * 0.6;
        walker.zIndex = Math.round(walker.y);
        applyWalkerFrame(walker, dirTextures, walkFrameIdx + i, dir.flipX, banditScale);
      });
      return;
    }

    // Past flash — outcome branch.
    if (phase.outcome.type === 'defeated') {
      // 15.5–17.5s: 3-frame death sequence per bandit (independent flicker).
      // 17.5–25.5s: tombstone fade.
      // 25.5+: hidden.
      if (t < BATTLE_T_FADE_END) {
        const isDeathPhase = t < BATTLE_T_DEATH_END;
        const fadeT = isDeathPhase
          ? 0
          : clamp01((t - BATTLE_T_DEATH_END) / (BATTLE_T_FADE_END - BATTLE_T_DEATH_END));
        const deathPhaseT = clamp01((t - BATTLE_T_FLASH_END) / (BATTLE_T_DEATH_END - BATTLE_T_FLASH_END));
        // Each frame is ~0.5s of the 2s window; flicker x2 per frame at high frequency.
        // frame 0 (back): 0–0.25 (frame in)
        // frame 1 (face-down): 0.25–0.5
        // frame 2 (tombstone): 0.5–1.0 hold
        const deathFrameIdx =
          deathPhaseT < 0.25 ? 0
            : deathPhaseT < 0.5 ? 1
              : 2;
        // Flicker: square wave at 8Hz — but ONLY for frames 0–1. Once we
        // transition to the tombstone (frame 2) the sprite stays solid and
        // only the fade-out drives alpha. Flashing the tombstone reads as
        // a broken/strobing asset (Liam UAT 2026-05-11).
        const flickerOn = Math.floor(renderNow / 125) % 2 === 0;
        const isTombstoneFrame = deathFrameIdx >= 2;
        const flickerAlpha = isTombstoneFrame ? 1 : (flickerOn ? 1 : 0.55);
        animState.deathSprites.forEach((dead, i) => {
          if (i >= 3) return;
          dead.visible = true;
          dead.alpha = (1 - fadeT) * flickerAlpha;
          const ang = (i * Math.PI * 2 / 3);
          const radius = 50 * layoutScale;
          dead.x = targetCenter!.x + Math.cos(ang) * radius;
          dead.y = targetCenter!.y + Math.sin(ang) * radius * 0.6;
          dead.zIndex = Math.round(dead.y);
          applyDeathFrame(dead, animState.deathTextures, deathFrameIdx, deathScale);
        });
      }
      // After fade end, container will be hidden by next frame (phase becomes 'hidden').
      return;
    }

    if (phase.outcome.type === 'won') {
      // 14.5/15.5–17s: cluster on base (after flash).
      // 17–18.5s: cluster pause.
      // 18.5–25.5s: walk to next region.
      // 25.5+: render new camp at toRegion (handled by phase becoming camp_idle once snapshot updates).
      const toRegionKey = REGION_KEY_BY_CHAIN_ID[phase.outcome.toRegion];
      const toAnchor = toRegionKey ? projectedBanditCampAnchor(toRegionKey) : null;

      if (t < BATTLE_T_WIN_CLUSTER_END) {
        // Cluster pause near target base.
        animState.walkers.forEach((walker, i) => {
          if (i >= 3) return;
          walker.visible = true;
          walker.alpha = 1;
          const offsetX = (i - 1) * 14 * layoutScale;
          const jitter = Math.sin(renderNow / 200 + i) * 1.5;
          walker.x = targetCenter!.x + offsetX;
          walker.y = targetCenter!.y + 8 * layoutScale + jitter;
          walker.zIndex = Math.round(targetCenter!.y + 8 * layoutScale);
          applyWalkerFrame(walker, dirTextures, 0, dir.flipX, banditScale); // standing pose
        });
      } else if (t < BATTLE_T_WIN_WALK_END && toAnchor) {
        // Walk to next region.
        const walkT = clamp01((t - BATTLE_T_WIN_CLUSTER_END) / (BATTLE_T_WIN_WALK_END - BATTLE_T_WIN_CLUSTER_END));
        const walkDir = pickWalkDirection(targetCenter!, toAnchor);
        const walkTextures = animState.walkTextures[walkDir.textures];
        animState.walkers.forEach((walker, i) => {
          if (i >= 3) return;
          walker.visible = true;
          walker.alpha = 1;
          const lateral = (i - 1) * 14 * layoutScale;
          walker.x = lerp(targetCenter!.x, toAnchor.x, easeInOutQuad(walkT)) + lateral * (1 - walkT);
          walker.y = lerp(targetCenter!.y, toAnchor.y, easeInOutQuad(walkT));
          walker.zIndex = Math.round(walker.y);
          applyWalkerFrame(walker, walkTextures, walkFrameIdx + i, walkDir.flipX, banditScale);
        });
      } else if (toAnchor) {
        // After walk: hold a glowing camp at destination until snapshot updates.
        if (animState.campSprite) {
          animState.campSprite.visible = true;
          animState.campSprite.x = toAnchor.x;
          animState.campSprite.y = toAnchor.y;
          animState.campSprite.scale.set(banditScale * 1.6);
          animState.campSprite.zIndex = Math.round(toAnchor.y);
        }
        if (animState.campGlow) {
          animState.campGlow.clear();
          animState.campGlow.circle(toAnchor.x, toAnchor.y - 6 * layoutScale, 28 * layoutScale);
          animState.campGlow.fill({ color: 0xcc1122, alpha: 0.55 });
          animState.campGlow.alpha = clamp01((t - BATTLE_T_WIN_WALK_END) / 0.05) * 0.85;
          animState.campGlow.zIndex = Math.round(toAnchor.y) - 1;
        }
      }
      return;
    }

    // no_battle_advance is handled at the top-level phase dispatcher.
  }

  function buildScene(isAssetLoadCancelled: () => boolean) {
    const drawn = drawnRef.current;
    const layers = layersRef.current;
    if (!layers) return;

    // Demo-only extras use mock data. Live bases are synced from snapshot clans
    // after regions are created, because the chain snapshot can arrive after Pixi init.
    if (DEMO_MODE) {
      // Clan zones (big translucent breathing halos) — drawn FIRST so everything else
      // sits on top. Visual sense of "this clan controls this zone."
      for (const clan of MOCK_CLANS) {
        const zoneGfx = new Graphics();
        layers.terrainAccents.addChild(zoneGfx);
        drawn.clanZones.push({ gfx: zoneGfx, clan });
      }
    }

    // Region polygon debug overlay (toggle via SHOW_REGION_POLYGONS). Added to
    // terrainBackground BEFORE the region dots/labels so dots+labels render on
    // top. terrainBackground sits below terrainAccents (clanZones live there),
    // so the overlay correctly draws between bg image and clan zones.
    for (let i = 0; i < REGIONS.length; i++) {
      const g = new Graphics();
      layers.terrainBackground.addChild(g);
      drawn.regionPolygons.push(g);

      // One Text per polygon vertex, showing its (x,y) polygon coords. Added to
      // terrainBackground AFTER the Graphics so labels render on top of the fill.
      const vertexLabels: Text[] = [];
      const regionDef = REGIONS[i];
      if (SHOW_REGION_POLYGONS && regionDef) {
        for (const [px, py] of regionDef.polygon) {
          const t = new Text({
            text: `(${px},${py})`,
            style: {
              fill: 0xffffff,
              fontSize: 10,
              fontFamily: 'monospace',
              stroke: { color: 0x000000, width: 3 },
            },
          });
          t.anchor.set(0.5, 0.5);
          layers.terrainBackground.addChild(t);
          vertexLabels.push(t);
        }
      }
      drawn.regionVertexLabels.push(vertexLabels);
    }

    for (const region of REGIONS) {
      const g = new Graphics();
      layers.terrainBackground.addChild(g);
      drawn.regions.push(g);

      const label = new Text({
        text: region.name,
        style: { fill: 0xdddddd, fontSize: 11, fontFamily: 'monospace' },
      });
      label.anchor.set(0.5, 0);
      layers.terrainBackground.addChild(label);
      drawn.regionLabels.push(label);
    }

    if (DEMO_MODE) {
      // Wall rings — drawn first so they sit above region circles but under sigils.
      for (const clan of MOCK_CLANS) {
        const wallGfx = new Graphics();
        layers.worldDynamic.addChild(wallGfx);
        drawn.walls.push({ gfx: wallGfx, clan });
      }

      // Monument towers — drawn before flags so sigil layers cleanly on top.
      for (const clan of MOCK_CLANS) {
        const monGfx = new Graphics();
        layers.worldDynamic.addChild(monGfx);
        drawn.monuments.push({ gfx: monGfx, clan });
      }

      for (const clan of MOCK_CLANS) {
        const flag = new Graphics();
        layers.worldDynamic.addChild(flag);
        const label = new Text({
          text: clan.name,
          style: { fill: clan.color, fontSize: 10, fontFamily: 'monospace', fontWeight: 'bold' },
        });
        label.anchor.set(0, 1);
        layers.worldDynamic.addChild(label);
        const entry: { gfx: Graphics; sprite: Sprite | null; label: Text; clan: ClanDef } = {
          gfx: flag,
          sprite: null,
          label,
          clan,
        };
        drawn.flags.push(entry);

        // Async-load clan sigil sprite (PR #42). Fallback rect (gfx) shows during load and
        // remains visible if load fails. Once loaded, sprite is positioned by relayout.
        Assets.load(clan.sigil)
          .then((texture) => {
            const cancelled = isAssetLoadCancelled();
            if (cancelled || !appRef.current) return;
            const sprite = new Sprite(texture);
            sprite.alpha = 0; // hidden until first relayout positions it
            layers.worldDynamic.addChild(sprite);
            entry.sprite = sprite;
            // Trigger a relayout so sprite gets positioned and shown.
            const wrap = canvasWrapRef.current;
            if (wrap && appRef.current) {
              relayout(WORLD_WIDTH, WORLD_HEIGHT);
            }
          })
          .catch(() => {
            // Keep fallback rect visible.
          });
      }

      createBaseVisuals(MOCK_CLANS, isAssetLoadCancelled);
    } // end DEMO_MODE block

    createBanditVisuals(isAssetLoadCancelled);
    if (!DEMO_MODE) syncLiveClanVisuals(isAssetLoadCancelled);
  }

  // ---- Layout: scale all draw coords from REF frame to canvas dimensions ---
  // Stretches positions to fill the viewport (so 8 regions fit on tall portrait
  // phones AND wide landscape) while keeping circles circular (uniform radius).
  function relayout(w: number, h: number) {
    // Relayout operates in native world-map coordinates; the pixi viewport handles
    // screen fit and UI chrome sits above the canvas.
    const sideMargin = 0;
    const topMargin = 0;
    const bottomMargin = 0;
    const usableW = Math.max(80, w - 2 * sideMargin);
    const usableH = Math.max(80, h - topMargin - bottomMargin);
    const scaleX = usableW / REF_W;
    const scaleY = usableH / REF_H;
    // Uniform scale used for sizes (radii / labels) — prevents distortion.
    const sizeScale = Math.min(scaleX, scaleY);
    // Cap the size scale so labels don't get giant on big desktop monitors.
    const cappedSizeScale = Math.min(sizeScale, 1.4);
    const offsetX = sideMargin;
    const offsetY = topMargin;

    layoutRef.current = { scale: cappedSizeScale, scaleX, scaleY, offsetX, offsetY };
    // Locally compute scaled coords (positions stretch, sizes uniform)
    const projX = (nx: number) => offsetX + nx * REF_W * scaleX;
    const projY = (ny: number) => offsetY + ny * REF_H * scaleY;

    const drawn = drawnRef.current;
    // Smaller terrain dots — zones below now carry the "control area" weight
    const regionRadius = 18 * cappedSizeScale;

    // Background terrain renders at native world resolution (MAP_WIDTH x MAP_HEIGHT).
    // The viewport handles fit-cover scaling, so we never stretch the bg here.
    if (drawn.bgSprite) {
      drawn.bgSprite.width = MAP_WIDTH;
      drawn.bgSprite.height = MAP_HEIGHT;
      drawn.bgSprite.x = 0;
      drawn.bgSprite.y = 0;
    }

    const layers = layersRef.current;
    if (layers && DEMO_MODE) {
      layers.combatDim.clear();
      layers.combatDim.rect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
      layers.combatDim.fill({ color: COMBAT_DIM_TINT, alpha: 1 });
      layers.combatFlash.clear();
      layers.combatFlash.rect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
      layers.combatFlash.fill({ color: 0xffffff, alpha: 1 });
    }

    const regionMap = new Map(REGIONS.map(r => [r.id, r]));

    // Big translucent CLAN ZONES — drawn first, breathing animation ticker pulses alpha.
    // Stored geometry only here; alpha applied per-tick.
    drawn.clanZones.forEach(({ gfx, clan }) => {
      const base = regionMap.get(clan.homeRegion);
      if (!base) return;
      const cx = projX(base.nx);
      const cy = projY(base.ny);
      // Radius targets ~150-200px range; scaled by cappedSizeScale so it stays
      // proportionate on tall portrait screens.
      const r = 95 * cappedSizeScale;
      gfx.clear();
      // Outer soft ring
      gfx.circle(cx, cy, r);
      gfx.fill({ color: clan.color, alpha: 0.18 });
      // Inner brighter core for "this is the base"
      gfx.circle(cx, cy, r * 0.55);
      gfx.fill({ color: clan.color, alpha: 0.28 });
      // Crisp edge stroke
      gfx.circle(cx, cy, r);
      gfx.stroke({ color: clan.color, width: 2, alpha: 0.55 });
    });

    // Region polygon DEBUG overlay — when SHOW_REGION_POLYGONS is true, fill +
    // stroke each region.polygon in its color so we can visually inspect the
    // hand-tuned polygons against the map. Projects native-pixel polygon coords
    // through projX/projY so the overlay tracks the viewport.
    REGIONS.forEach((region, i) => {
      const g = drawn.regionPolygons[i];
      if (!g) return;
      g.clear();
      if (!SHOW_REGION_POLYGONS) return;
      const pts: number[] = [];
      for (const [px, py] of region.polygon) {
        pts.push(projX(px / REF_W), projY(py / REF_H));
      }
      g.poly(pts);
      g.fill({ color: region.color, alpha: 0.30 });
      g.poly(pts);
      g.stroke({ color: region.color, width: 2, alpha: 0.85 });

      // Position each vertex label at its projected screen coord. Polygon
      // dimensions can change (region.polygon mutated during tuning), so we
      // tolerate label-array length drift by skipping out-of-range entries.
      const vertexLabels = drawn.regionVertexLabels[i] ?? [];
      region.polygon.forEach(([px, py], v) => {
        const t = vertexLabels[v];
        if (!t) return;
        t.text = `(${px},${py})`;
        t.x = projX(px / REF_W);
        t.y = projY(py / REF_H);
        t.style.fontSize = Math.max(8, Math.round(10 * cappedSizeScale));
      });
    });

    // Region dots — small, just to mark non-clan locations (mountains, deep sea, town).
    REGIONS.forEach((region, i) => {
      const cx = projX(region.nx);
      const cy = projY(region.ny);
      const g = drawn.regions[i];
      // Hide region dots that are home to a clan (zone halo replaces them visually).
      const isClanHome = drawn.clanZones.some(({ clan }) => clan.homeRegion === region.id);
      if (g) {
        g.clear();
        if (!isClanHome) {
          g.circle(cx, cy, regionRadius);
          g.fill({ color: region.color, alpha: 0.6 });
          g.stroke({ color: 0xffffff, width: 1, alpha: 0.4 });
        }
      }
      const label = drawn.regionLabels[i];
      if (label) {
        label.style.fontSize = Math.max(10, Math.round(13 * cappedSizeScale));
        label.x = cx;
        label.y = cy + (isClanHome ? 0 : regionRadius + 4);
        label.alpha = isClanHome ? 0 : 0.8;
      }
    });

    if (drawn.bases.length > 0) {
      // Build per-clan monument level lookup. Prefer live snapshot via treasury;
      // fall back to the visual clan level/base level metadata.
      const liveClans = snapshot?.clans as SnapshotClan[] | undefined;
      const levelByClan = new Map<string, number>();
      if (liveClans && liveClans.length > 0) {
        for (const c of liveClans) {
          levelByClan.set(c.id, c.baseLevel ?? c.monumentLevel ?? treasuryToMonument(c.treasury));
        }
      }
      drawn.bases.forEach(({ clan }, i) => {
        if (!levelByClan.has(clan.id)) levelByClan.set(clan.id, clan.level ?? (DEMO_MODE ? 4 - i : 1));
      });

      // Wall rings — visually replaced by zone halos. Clear graphics; keep refs.
      drawn.walls.forEach(({ gfx }) => {
        gfx.clear();
      });

      // Monument towers — stacked rectangles + top cap, height grows with level.
      // Positioned at the flag location, just below the sigil so it reads as
      // "the clan's structure at their homebase."
      // Old monument obelisks — replaced by base sprites + floating Lv badges.
      // Keep refs alive (cleanup is done in unmount) but draw nothing.
      drawn.monuments.forEach(({ gfx }) => {
        gfx.clear();
      });

      // Clan sigil flags — REPLACED by base sprites. Hide them but keep bubble
      // anchors so the speech-bubble system still has positions to attach to.
      drawn.flags.forEach(({ gfx, sprite, label, clan }) => {
        const base = regionMap.get(clan.homeRegion);
        if (!base) return;
        const cx = projX(base.nx);
        const cy = projY(base.ny);
        const level = levelByClan.get(clan.id) ?? clan.level ?? 1;
        const baseSize = Math.max(67, 101 * cappedSizeScale) * baseVisualScale(level);
        // Hide everything visually
        gfx.clear();
        if (sprite) sprite.alpha = 0;
        label.alpha = 0;
        // Bubble anchor: top of base sprite
        flagAnchorsRef.current.set(clan.id, { x: cx, y: cy - baseSize * 1.05 });
      });

      // BASE SPRITES — render at clan home positions, replacing monument obelisks.
      drawn.bases.forEach((entry) => {
        const { container, sprite, fallback, glow, clan } = entry;
        const base = regionMap.get(clan.homeRegion);
        if (!base) return;
        const cx = projX(base.nx);
        const cy = projY(base.ny);
        // Base size: ~128px at 1x scale, scales with viewport (2x bump for phone readability)
        const level = levelByClan.get(clan.id) ?? clan.level ?? 1;
        const baseSize = Math.max(67, 101 * cappedSizeScale) * baseVisualScale(level);
        entry.baseY = cy + baseSize * 0.15;
        entry.phaseOffset = ((Math.round(cx) * 73) ^ (Math.round(entry.baseY) * 31)) % 4000;
        container.x = cx;
        container.y = entry.baseY;
        container.zIndex = Math.round(entry.baseY);
        container.hitArea = new Rectangle(-baseSize / 2, -baseSize, baseSize, baseSize);
        fallback.clear();
        if (!sprite) {
          // Simple colored fallback rect with clan-color border
          fallback.rect(-baseSize / 2, -baseSize, baseSize, baseSize);
          fallback.fill({ color: 0x444444, alpha: 0.7 });
          fallback.stroke({ color: clan.color, width: 3 });
        }
        if (sprite) {
          sprite.width = baseSize;
          sprite.height = baseSize;
          sprite.x = 0;
          sprite.y = 0; // anchor=bottom-center; parent sits slightly below region center
          sprite.alpha = 1;
          // Cache the natural scale.y so the breathing tick can multiply, not
          // clobber. sprite.height = baseSize internally sets scale.y to
          // baseSize/texture.height (often ~0.3-0.5); the breathing animation
          // must preserve that ratio.
          entry.baseScaleY = sprite.scale.y;
        } else {
          // Fallback Graphics is drawn at native coords (scale.y === 1).
          entry.baseScaleY = 1;
        }
        glow.clear();
        glow.circle(0, -baseSize * 0.8, Math.max(6, 8 * cappedSizeScale));
        glow.fill({ color: 0xffd27d, alpha: 0.6 });
      });

      // FLOATING "Lv N" BADGES — beside each base sprite. Updates with monument level.
      drawn.levelBadges.forEach(({ bg, label, clan }) => {
        const base = regionMap.get(clan.homeRegion);
        if (!base) return;
        const lvl = levelByClan.get(clan.id) ?? 0;
        const baseSize = Math.max(67, 101 * cappedSizeScale) * baseVisualScale(lvl);
        label.text = `Lv ${lvl}`;
        label.style.fontSize = Math.max(11, Math.round(13 * cappedSizeScale));
        // Position to the right of the base sprite, near the top
        const bx = baseSize * 0.55;
        const by = -baseSize * 0.7;
        label.x = bx;
        label.y = by;
        // Pill background
        const pad = Math.max(4, 6 * cappedSizeScale);
        const w = label.width + pad * 2;
        const h = label.height + pad * 0.6;
        bg.clear();
        bg.roundRect(bx - w / 2, by - h / 2, w, h, h / 2);
        bg.fill({ color: 0x0d1a0d, alpha: 0.85 });
        bg.stroke({ color: clan.color, width: 1.5, alpha: 0.95 });
      });

      updateLiveClansmanPositions();
      applyClanFocus(selectedClanIdRef.current);

      // Bandit redraw uses live tick — recompute alongside layout.
      // Skip during active vignette so a snapshot.clans-driven relayout
      // doesn't snap the reparented bandit back to home anchor mid-
      // choreography (opus 4.7 r4 LOW). The vignette ticker self-corrects
      // on the next frame anyway, but a one-frame snap is visible.
      if (DEMO_MODE && !combatVignetteRef.current) redrawBandit();
    } // end clan base relayout block
  }

  // ---- Bandit: hooded silhouette + ticks-until-attack readout
  // (style/bandit-archetype-sprites): replaces the prior red "!" disc with a
  // codex/PIL-rendered bandit sprite. A subtle red ring stays as fallback while
  // the sprite loads or if the asset fails.
  function redrawBandit() {
    const drawn = drawnRef.current;
    const icon = drawn.banditIcon;
    const sprite = drawn.banditSprite;
    const text = drawn.banditCountdown;
    if (!icon || !text) return;

    // Live-mode (non-DEMO) defers to the new bandit-attack phase machine
    // (docs/planning/bandit-animation-impl-plan.md). The phase machine owns
    // the camp/walking/battle/death rendering through its own container.
    // The legacy red ring + bandit silhouette + "Nt" countdown are no longer
    // shown in production — they'd render on top of the phase sprites.
    // DEMO_MODE keeps the legacy flow intact so the existing combat vignette
    // still triggers on `?combat=success`.
    if (!DEMO_MODE) {
      icon.clear();
      icon.visible = false;
      icon.alpha = 0;
      if (sprite) {
        sprite.visible = false;
        sprite.alpha = 0;
      }
      text.visible = false;
      return;
    }

    if (!visibleBandit || !visibleBandit.regionKey) {
      icon.clear();
      icon.visible = false;
      icon.alpha = 0;
      if (sprite) {
        sprite.visible = false;
        sprite.alpha = 0;
      }
      text.visible = false;
      return;
    }

    // After a `?combat=success` demo vignette completes, the demo bandit is defeated.
    // Skip all redraw / re-show on subsequent layouts (gemini r3 HIGH #2).
    if (DEMO_MODE && banditDefeatedRef.current) {
      icon.visible = false;
      icon.alpha = 0;
      if (sprite) {
        sprite.visible = false;
        sprite.alpha = 0;
      }
      text.visible = false;
      return;
    }

    const region = REGIONS.find(r => r.id === visibleBandit.regionKey);
    if (!region) return;
    const { scale, scaleX, scaleY, offsetX, offsetY } = layoutRef.current;
    const cx = offsetX + region.nx * REF_W * scaleX;
    const cy = offsetY + region.ny * REF_H * scaleY;

    // Bandit perches above-left of region circle. Sprite size ~32px at 1x scale,
    // matching the prior icon's visual weight while leaving room for the countdown.
    const iconX = cx - 28 * scale;
    const iconY = cy - 42 * scale;
    const spriteSize = Math.max(24, 32 * scale);
    const ringR = Math.max(10, 14 * scale);
    const banditZ = Math.round(iconY);

    icon.clear();
    icon.visible = true;
    icon.alpha = 1;
    icon.x = iconX;
    icon.y = iconY;
    icon.zIndex = banditZ;
    if (!sprite) {
      // Fallback ring while the sprite loads / on asset failure.
      // Draw shapes at icon-local origin so target.getGlobalPosition() in
      // selectTarget() resolves to the visible center, not the parent layer's origin.
      icon.circle(0, 0, ringR);
      icon.fill({ color: 0xcc1122, alpha: 0.85 });
      icon.stroke({ color: 0xffffff, width: 2 });
      const barW = Math.max(2, 3 * scale);
      const barH = ringR * 0.95;
      icon.rect(-barW / 2, -barH / 2, barW, barH * 0.6);
      icon.fill({ color: 0xffffff });
      icon.circle(0, barH * 0.35, Math.max(1.5, barW * 0.7));
      icon.fill({ color: 0xffffff });
    }

    if (sprite) {
      sprite.width = spriteSize;
      sprite.height = spriteSize;
      sprite.x = iconX;
      sprite.y = iconY;
      sprite.zIndex = banditZ;
      sprite.visible = true;
      sprite.alpha = 1;
    }

    const ticksUntil = Math.max(0, visibleBandit.nextActionTick - liveTick);
    text.visible = true;
    text.text = visibleBandit.state === BanditState.Attacking ? 'raid' : `${ticksUntil}t`;
    text.style.fontSize = Math.max(10, Math.round(12 * scale));
    // Anchor the countdown to the right edge of whichever marker is active.
    const markerHalfW = sprite ? spriteSize / 2 : ringR;
    text.x = iconX + markerHalfW + 4;
    text.y = iconY;
  }

  function getMsUntilTickClose() {
    const clockEpoch = tickClockEpochRef.current;
    const snap = snapshotRef.current;
    const epoch = clockEpoch
      ? { startedAt: clockEpoch.startedAt, durationMs: clockEpoch.durationMs }
      : snap?.tickEpoch;
    const durationMs =
      epoch && typeof epoch.durationMs === 'number' && epoch.durationMs > 0
        ? epoch.durationMs
        : FALLBACK_DAY_TICK_MS;
    if (epoch && typeof epoch.startedAt === 'number' && epoch.startedAt > 0 && (clockEpoch?.tick ?? snap?.tick) === liveTickRef.current) {
      const startedAtMs = epoch.startedAt < 10_000_000_000 ? epoch.startedAt * 1000 : epoch.startedAt;
      return Math.max(0, durationMs - (Date.now() - startedAtMs));
    }
    const elapsed = Date.now() - liveTickClockRef.current.seenAtMs;
    return Math.max(0, durationMs - elapsed);
  }

  function shouldStartDemoCombatVignette() {
    // Under CAPTURE_MODE the scripted hero camera owns the viewport; the
    // auto-combat vignette would fight it (it re-centers/zooms on its target).
    if (CAPTURE_MODE) return false;
    if (!DEMO_MODE || combatVignetteRef.current || pendingCombatTriggerRef.current) return false;
    const attackTick = DEMO_BANDIT.attacksAtTick;
    if (combatPlayedTickRef.current === attackTick) return false;
    const currentTick = liveTickRef.current;
    if (currentTick === attackTick - 1) {
      // Codex cloud P1: when tickEpoch is unavailable (Sub1 logs-driven liveTick
      // mode where ticks advance every ~20s but FALLBACK_DAY_TICK_MS is 60s),
      // `getMsUntilTickClose()` never drops to ≤4000ms before liveTick rolls
      // forward — the precise pre-close window never fires and the vignette
      // only triggers post-close (line below). Detect fallback mode and
      // trigger as soon as we enter the pre-attack tick. Vignette occupies the
      // first 4s of the pre-attack tick instead of the last 4s; visually similar.
      const clockEpoch = tickClockEpochRef.current;
      const snap = snapshotRef.current;
      const epoch = clockEpoch
        ? { startedAt: clockEpoch.startedAt, durationMs: clockEpoch.durationMs }
        : snap?.tickEpoch;
      const havePreciseEpoch =
        epoch && typeof epoch.startedAt === 'number' && epoch.startedAt > 0
        && typeof epoch.durationMs === 'number' && epoch.durationMs > 0;
      if (havePreciseEpoch) {
        return getMsUntilTickClose() <= COMBAT_VIGNETTE_LEAD_MS;
      }
      return true;
    }
    return currentTick >= attackTick;
  }

  function makeCombatDefender(color: number, clanId: string) {
    const tex = clansmanTextureCache[clanId];
    if (tex) {
      const sprite = new Sprite(tex);
      sprite.anchor.set(0.5, 0.5);
      const targetH = 32;
      const ratio = targetH / sprite.texture.height;
      sprite.height = targetH;
      sprite.width = sprite.texture.width * ratio;
      return sprite;
    }

    const fallback = new Graphics();
    fallback.circle(0, 0, 8);
    fallback.fill({ color, alpha: 1 });
    fallback.stroke({ color: 0xffffff, width: 1, alpha: 0.75 });
    return fallback;
  }

  function reparentForCombat(node: Container, vignette: CombatVignette, wasTemporary = false) {
    const layers = layersRef.current;
    const parent = node.parent;
    if (!layers || !(parent instanceof Container)) return;
    vignette.reparented.push({ node, parent, zIndex: node.zIndex, wasTemporary });
    parent.removeChild(node);
    layers.combatHighlight.addChild(node);
    node.zIndex = Math.round(node.y);
  }

  function startCombatVignette(trigger?: CombatTrigger): boolean {
    if (!DEMO_MODE) return false;
    const layers = layersRef.current;
    if (!layers) return false;
    const drawn = drawnRef.current;
    const targetBase = trigger?.targetClanId
      ? drawn.bases.find(b => b.clan.id === trigger.targetClanId)
      : drawn.bases.find(b => b.clan.id === COMBAT_TARGET_CLAN_ID)
        ?? drawn.bases.find(b => b.clan.homeRegion === DEMO_BANDIT.regionId);
    if (!targetBase) return false;
    const targetClan = targetBase.clan;

    const targetBaseNode = targetBase.container;
    const baseSize = Math.max(67, 101 * layoutRef.current.scale);
    const center = {
      x: targetBaseNode.x,
      y: targetBaseNode.y - baseSize * 0.55,
    };
    const bandit = drawn.banditSprite ?? drawn.banditIcon;
    if (!bandit) return false;
    if (trigger?.liveMode && !visibleBandit) {
      bandit.visible = true;
      bandit.alpha = 1;
      bandit.x = center.x - 96;
      bandit.y = center.y - 16;
    }

    // Mark this tick as played BEFORE any reparenting / mutation so a partial-start
    // throw can't loop the per-frame ticker into spawning new defender nodes every
    // frame (codex r3 SHOULD #1).
    if (!trigger?.liveMode) {
      combatPlayedTickRef.current = DEMO_BANDIT.attacksAtTick;
    }

    // §14.3: combatDim sits above worldDynamic and would otherwise dim the
    // active selection ring. Clear the ring (without the camera fit-out) so
    // the dimmed world reads cleanly. Speech bubbles still dim mid-flight
    // (structural fix queued for v1.2) — claude r3 MUST #3 cheap fix.
    const selected = selectedRef.current;
    if (selected) {
      selected.target.removeChild(selected.ring);
      selected.ring.destroy();
      selectedRef.current = null;
    }

    const defenderAngles = [Math.PI * 0.75, Math.PI * 0.5, Math.PI * 0.25];
    const defenders = defenderAngles.map((angle) => {
      const defender = makeCombatDefender(targetClan.color, targetClan.id);
      defender.x = center.x + Math.cos(angle) * 58;
      defender.y = center.y + Math.sin(angle) * 34;
      defender.zIndex = Math.round(defender.y);
      layers.worldDynamic.addChild(defender);
      return defender;
    });
    const warningRing = new Graphics();
    const targetPulse = new Graphics();
    const marchLine = new Graphics();
    const aftermath = new Graphics();
    const warningText = new Text({
      text: 'RAID',
      style: {
        fill: 0xffe9b8,
        fontSize: 14,
        fontFamily: '"Cinzel", "Times New Roman", serif',
        fontWeight: '900',
        stroke: { color: 0x2b0909, width: 3 },
      },
    });
    warningText.anchor.set(0.5, 1);
    layers.inWorldEffects.addChild(marchLine, targetPulse, warningRing, aftermath, warningText);

    const vignette: CombatVignette = {
      startedAt: performance.now(),
      outcome: trigger?.outcome ?? readDemoCombatOutcome(),
      liveMode: trigger?.liveMode ?? false,
      bandit,
      targetBase: targetBaseNode,
      defenders,
      warningRing,
      targetPulse,
      marchLine,
      aftermath,
      warningText,
      reparented: [],
      baseStart: {
        x: targetBaseNode.x,
        y: targetBaseNode.y,
        scaleX: targetBaseNode.scale.x,
        scaleY: targetBaseNode.scale.y,
      },
      banditStart: {
        x: bandit.x,
        y: bandit.y,
        scaleX: bandit.scale.x,
        scaleY: bandit.scale.y,
        alpha: bandit.alpha,
      },
      defenderStarts: defenders.map(d => ({ x: d.x, y: d.y })),
      center,
    };

    reparentForCombat(targetBaseNode, vignette);
    reparentForCombat(bandit, vignette);
    defenders.forEach(defender => reparentForCombat(defender, vignette, true));
    combatVignetteRef.current = vignette;
    return true;
  }

  function finishCombatVignette(force = false) {
    const vignette = combatVignetteRef.current;
    const layers = layersRef.current;
    if (!vignette || !layers) return;

    layers.combatDim.alpha = 0;
    layers.combatFlash.alpha = 0;
    vignette.targetBase.x = vignette.baseStart.x;
    vignette.targetBase.y = vignette.baseStart.y;
    vignette.targetBase.scale.set(vignette.baseStart.scaleX, vignette.baseStart.scaleY);
    // On success outcome the vignette fades the bandit to alpha=0 + 0.3 scale;
    // unconditionally restoring banditStart would pop the defeated bandit
    // back to full opacity (gemini r3 HIGH #2). Lock the defeated state via
    // banditDefeatedRef + skip the visual restore on success.
    if (vignette.outcome === 'success' && !force) {
      if (!vignette.liveMode) banditDefeatedRef.current = true;
      if (vignette.bandit) {
        vignette.bandit.alpha = 0;
        vignette.bandit.visible = false;
      }
    } else if (vignette.bandit) {
      vignette.bandit.x = vignette.banditStart.x;
      vignette.bandit.y = vignette.banditStart.y;
      vignette.bandit.scale.set(vignette.banditStart.scaleX, vignette.banditStart.scaleY);
      vignette.bandit.alpha = vignette.banditStart.alpha;
    }

    for (const item of vignette.reparented) {
      if (item.node.parent) item.node.parent.removeChild(item.node);
      if (item.wasTemporary) {
        item.node.destroy({ children: true });
        continue;
      }
      item.parent.addChild(item.node);
      item.node.zIndex = item.zIndex;
    }
    layers.combatHighlight.removeChildren();
    vignette.warningRing.destroy();
    vignette.targetPulse.destroy();
    vignette.marchLine.destroy();
    vignette.aftermath.destroy();
    vignette.warningText.destroy();
    combatVignetteRef.current = null;
    if (!force) redrawBandit();
  }

  function updateCombatVignette() {
    if (!DEMO_MODE) return;
    const pendingTrigger = pendingCombatTriggerRef.current;
    if (pendingTrigger && !combatVignetteRef.current) {
      if (startCombatVignette(pendingTrigger)) {
        pendingCombatTriggerRef.current = null;
      }
    } else if (shouldStartDemoCombatVignette()) {
      startCombatVignette();
    }
    const vignette = combatVignetteRef.current;
    const layers = layersRef.current;
    if (!vignette || !layers) return;

    const now = performance.now();
    const age = now - vignette.startedAt;
    if (age >= COMBAT_TOTAL_MS) {
      finishCombatVignette();
      return;
    }

    // §10.8 cap rule: combat dim must not stack with day/night darkening into
    // an unreadable scene. The naive `min(0.55, 1 - brightness)` reads the
    // spec literally but inverts the intent — at full daylight (brightness=1)
    // it gives 0, killing combat dim during the brightest part of the cycle
    // (codex 5.4 SuperSwarm catch). Correct semantic: dim down by the AMOUNT
    // of existing day/night darkening so total visual darkness stays bounded.
    // Floor at 0.2 so combat still has a visible beat even at deep night.
    const dayNightBrightness = ENABLE_DAY_NIGHT_EFFECT
      ? getDayNightFrame(getDayNightProgress()).brightness
      : 1;
    const existingDarkness = clamp01(1 - dayNightBrightness);
    const dimTarget = Math.max(0.2, COMBAT_DIM_ALPHA - existingDarkness);
    const fadeOutStart = COMBAT_TOTAL_MS - 600;
    if (age < 600) {
      layers.combatDim.alpha = dimTarget * clamp01(age / 600);
    } else if (age >= fadeOutStart) {
      layers.combatDim.alpha = dimTarget * (1 - clamp01((age - fadeOutStart) / 600));
    } else {
      layers.combatDim.alpha = dimTarget;
    }

    const flashAge = age - COMBAT_FLASH_START_MS;
    if (flashAge < 0) {
      layers.combatFlash.alpha = 0;
    } else if (flashAge < COMBAT_FLASH_IN_MS) {
      layers.combatFlash.alpha = clamp01(flashAge / COMBAT_FLASH_IN_MS);
    } else if (flashAge < COMBAT_FLASH_IN_MS + COMBAT_FLASH_HOLD_MS) {
      layers.combatFlash.alpha = 1;
    } else {
      const fadeAge = flashAge - COMBAT_FLASH_IN_MS - COMBAT_FLASH_HOLD_MS;
      layers.combatFlash.alpha = Math.max(0, 1 - fadeAge / COMBAT_FLASH_FADE_MS);
    }

    const warningT = clamp01(age / COMBAT_WARNING_MS);
    const pulseR = 28 + Math.sin(now / 110) * 4;
    vignette.warningRing.clear();
    vignette.warningRing.circle(vignette.banditStart.x, vignette.banditStart.y, 16 + warningT * 34);
    vignette.warningRing.stroke({ color: 0xcc1122, width: 2, alpha: Math.max(0, 0.85 - warningT * 0.65) });
    vignette.targetPulse.clear();
    vignette.targetPulse.circle(vignette.center.x, vignette.center.y, pulseR);
    vignette.targetPulse.stroke({ color: 0xff3333, width: 3, alpha: 0.35 + Math.abs(Math.sin(now / 180)) * 0.35 });
    vignette.warningText.x = vignette.center.x;
    vignette.warningText.y = vignette.center.y - 72;
    vignette.warningText.alpha = age < COMBAT_RESOLUTION_START_MS ? 0.85 + Math.sin(now / 120) * 0.15 : 0;

    const marchEnd = { x: vignette.center.x - 28, y: vignette.center.y - 10 };
    vignette.marchLine.clear();
    vignette.marchLine.moveTo(vignette.banditStart.x, vignette.banditStart.y);
    vignette.marchLine.lineTo(marchEnd.x, marchEnd.y);
    vignette.marchLine.stroke({ color: 0x7f1d1d, width: 3, alpha: age < COMBAT_FLASH_START_MS ? 0.45 : 0.1 });

    if (age < COMBAT_WARNING_MS) {
      const brace = 1 + Math.sin(now / 90) * 0.04;
      if (vignette.bandit) {
        vignette.bandit.x = vignette.banditStart.x;
        vignette.bandit.y = vignette.banditStart.y + Math.sin(now / 140) * 2;
        vignette.bandit.scale.set(vignette.banditStart.scaleX * brace, vignette.banditStart.scaleY * brace);
      }
      vignette.defenders.forEach((defender, i) => {
        const start = vignette.defenderStarts[i];
        if (!start) return;
        defender.x = start.x;
        defender.y = start.y + Math.sin(now / 180 + i) * 1;
      });
    } else if (age < COMBAT_WARNING_MS + COMBAT_ADVANCE_MS) {
      const t = easeInOutQuad(clamp01((age - COMBAT_WARNING_MS) / COMBAT_ADVANCE_MS));
      if (vignette.bandit) {
        vignette.bandit.x = lerp(vignette.banditStart.x, marchEnd.x, t);
        vignette.bandit.y = lerp(vignette.banditStart.y, marchEnd.y, t);
      }
      vignette.defenders.forEach((defender, i) => {
        const start = vignette.defenderStarts[i];
        if (!start) return;
        defender.x = lerp(start.x, vignette.center.x + 20 + i * 10, t);
        defender.y = lerp(start.y, vignette.center.y + 12, t);
      });
    } else if (age < COMBAT_FLASH_START_MS) {
      const anticipationT = clamp01((age - COMBAT_WARNING_MS - COMBAT_ADVANCE_MS) / COMBAT_STANDOFF_MS);
      const jitter = Math.sin(now / 55) * (1 + anticipationT * 2);
      if (vignette.bandit) {
        const grow = 1 + anticipationT * 0.08;
        vignette.bandit.x = marchEnd.x + jitter;
        vignette.bandit.y = marchEnd.y;
        vignette.bandit.scale.set(vignette.banditStart.scaleX * grow, vignette.banditStart.scaleY * grow);
      }
      vignette.defenders.forEach((defender, i) => {
        defender.x = vignette.center.x + 20 + i * 10 - jitter;
        defender.y = vignette.center.y + 12 + Math.sin(now / 70 + i) * 2;
      });
    } else if (age >= COMBAT_RESOLUTION_START_MS) {
      const rAge = age - COMBAT_RESOLUTION_START_MS;
      vignette.aftermath.clear();
      if (vignette.outcome === 'success') {
        const launchT = easeOutQuad(clamp01(rAge / 850));
        if (vignette.bandit) {
          vignette.bandit.x = marchEnd.x - launchT * 92;
          vignette.bandit.y = marchEnd.y - launchT * 24;
          const fadeT = clamp01((rAge - 400) / 900);
          const s = lerp(1, 0.3, fadeT);
          vignette.bandit.scale.set(vignette.banditStart.scaleX * s, vignette.banditStart.scaleY * s);
          vignette.bandit.alpha = 1 - fadeT;
        }
        vignette.defenders.forEach((defender, i) => {
          defender.y = vignette.center.y + 12 + Math.sin(now / 90 + i) * 6;
        });
        const burstT = clamp01((rAge - 500) / 1400);
        for (let i = 0; i < 10; i++) {
          const a = (Math.PI * 2 * i) / 10;
          const d = 8 + burstT * (22 + i * 1.8);
          vignette.aftermath.rect(vignette.center.x + Math.cos(a) * d, vignette.center.y + Math.sin(a) * d * 0.55, 3, 3);
          vignette.aftermath.fill({ color: i % 3 === 0 ? 0xfff2a6 : 0xd4a24c, alpha: Math.max(0, 1 - burstT) });
        }
      } else {
        const jumpT = easeOutQuad(clamp01(rAge / 500));
        vignette.defenders.forEach((defender, i) => {
          const angle = Math.PI * (0.2 + i * 0.22);
          defender.x = vignette.center.x + 18 + i * 10 + Math.cos(angle) * 34 * jumpT;
          defender.y = vignette.center.y + 12 + Math.sin(angle) * 24 * jumpT;
        });
        const dropT = easeInQuad(clamp01(rAge / 700));
        vignette.targetBase.scale.y = lerp(vignette.baseStart.scaleY, vignette.baseStart.scaleY * 0.9, dropT);
        const lootT = clamp01((rAge - 350) / 1300);
        for (let i = 0; i < 8; i++) {
          const sx = vignette.center.x + (i - 3.5) * 5;
          const sy = vignette.center.y + 4 + Math.sin(i) * 5;
          const tx = marchEnd.x - 28 + (i % 3) * 5;
          const ty = marchEnd.y - 6 + Math.floor(i / 3) * 4;
          vignette.aftermath.rect(lerp(sx, tx, lootT), lerp(sy, ty, lootT), 4, 4);
          vignette.aftermath.fill({ color: [0x8b5a2b, 0x9ca3af, 0xd6b85a, 0x5aa7d6][i % 4]!, alpha: Math.max(0, 1 - lootT * 0.25) });
        }
      }
    }

	  if (vignette.bandit) vignette.bandit.zIndex = Math.round(vignette.bandit.y);
	  vignette.defenders.forEach(defender => {
	    defender.zIndex = Math.round(defender.y);
	  });
	  vignette.targetBase.zIndex = Math.round(vignette.targetBase.y);
	}

  useEffect(() => {
    if (!DEMO_MODE || !rawChainEvents || rawChainEvents.length === 0) return;
    const seen = seenCombatEventKeysRef.current;
    const now = Date.now();
    const sorted = rawChainEvents
      .slice()
      .sort((a, b) => (a.blockNumber ?? 0) - (b.blockNumber ?? 0) || (a.logIndex ?? 0) - (b.logIndex ?? 0));
    if (!combatEventsInitializedRef.current) {
      combatEventsInitializedRef.current = true;
      for (const ev of sorted) {
        if (ev.eventName !== 'BanditAttackResolved') continue;
        const isRecent = typeof ev.decodedAt === 'number' && now - ev.decodedAt <= RECENT_BANDIT_EVENT_THRESHOLD_MS;
        if (!isRecent) seen.add(eventKey(ev));
      }
    }
    for (const ev of sorted) {
      if (ev.eventName !== 'BanditAttackResolved') continue;
      const key = eventKey(ev);
      if (seen.has(key)) continue;
      seen.add(key);
      const args = (ev.args ?? {}) as Record<string, unknown>;
      const targetClanId = numberLike(args.targetClanId ?? ev.clanId);
      const defended = args.defended === true || numberLike(args.defended) === 1;
      const liveRegionKey =
        visibleBandit?.regionKey
        ?? REGION_KEY_BY_CHAIN_ID[liveBandit?.region ?? 0]
        ?? undefined;
      pendingCombatTriggerRef.current = {
        outcome: defended ? 'success' : 'failure',
        targetClanId: targetClanId > 0 ? String(targetClanId) : undefined,
        regionKey: liveRegionKey,
        playKey: key,
        liveMode: true,
      };
      // Only one trigger fits in pendingCombatTriggerRef; remaining unseen
      // events are kept (NOT in `seen`) and picked up on the next render.
      break;
    }
  }, [rawChainEvents, liveBandit, visibleBandit]);

  // Tick/snapshot changes: refresh bandit countdown and live visibility.
  // Skipped while a combat vignette is animating — redrawBandit overrides the
  // bandit sprite's x/y/zIndex back to the region anchor, snapping the bandit
  // out of mid-flight choreography (claude r3 MUST #1).
  useEffect(() => {
    if (!pixiReady || !DEMO_MODE) return;
    if (combatVignetteRef.current) return;
    redrawBandit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveTick, pixiReady, liveBandit]);

  // Winter snowfall: subscribe to `worldSnapshot.winterActive` and drive the
  // particle overlay's active state. Season fields are derived in getSnapshot
  // via deriveSeasonState() and present in the return type.
  const winterActive = snapshot?.winterActive === true;
  useEffect(() => {
    if (!pixiReady) return;
    const snow = winterSnowRef.current;
    if (!snow) return; // reduced-motion path — handle was never created
    snow.setActive(winterActive);
  }, [pixiReady, winterActive]);

  // Winter map-overlay edge detector. Same signal as the snow above, but
  // drives the alpha state machine of the winter map Sprite instead of the
  // particle system. The actual per-frame alpha math lives in the ticker
  // callback set up in the pixi-init useEffect (winterFadeCb); this effect
  // only flips phase + records start-time/start-alpha at the rising / falling
  // edge of `winterActive`. Mid-fade reversals are handled by reading the
  // sprite's current alpha as the next start-alpha, mirroring the
  // mid-fade-resume pattern in createWinterSnow.
  useEffect(() => {
    if (!pixiReady) return;
    const sprite = winterSpriteRef.current;
    if (!sprite) return; // texture-load failure path — silent fallback
    const prev = prevWinterActiveRef.current;
    prevWinterActiveRef.current = winterActive;
    // Skip on the very first observation — we don't want to fade IN on app
    // boot if the world is already in Winter (would look like a slow reveal of
    // existing state). Just snap to the correct alpha and phase.
    if (prev === null) {
      if (winterActive) {
        sprite.alpha = 1;
        winterFadePhaseRef.current = 'active';
      } else {
        sprite.alpha = 0;
        winterFadePhaseRef.current = 'idle';
      }
      return;
    }
    if (prev === winterActive) return; // no edge
    if (winterActive) {
      // Rising edge — entering Winter. Capture current alpha so a fade-in
      // mid fade-out resumes smoothly (no blink to 0 then up).
      winterFadeStartAlphaRef.current = sprite.alpha;
      winterFadeStartMsRef.current = performance.now();
      winterFadePhaseRef.current = 'fade-in';
    } else {
      // Falling edge — leaving Winter (entering Spring or whatever season
      // transitions out). Same mid-fade-resume logic: capture current alpha.
      winterFadeStartAlphaRef.current = sprite.alpha;
      winterFadeStartMsRef.current = performance.now();
      winterFadePhaseRef.current = 'fade-out';
    }
  }, [pixiReady, winterActive]);

  // Snapshot clan changes: re-layout so monument heights track live treasury.
  useEffect(() => {
    if (!pixiReady) return;
    const wrap = canvasWrapRef.current;
    if (!wrap) return;
    syncLiveClanVisuals(() => !isMountedRef.current);
    syncLiveClansmanVisuals(() => !isMountedRef.current);
    relayout(WORLD_WIDTH, WORLD_HEIGHT);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot?.clans, pixiReady]);

  // Pulse the bandit icon when the raid is imminent or attacking.
  useEffect(() => {
    if (!pixiReady || !DEMO_MODE) return;
    const app = appRef.current;
    if (!app) return;

    const resetBanditAlpha = () => {
      // Defeated bandit stays alpha=0 — don't reset to 1 (opus 4.6/4.7 r4
      // defensive). Currently masked by visible=false but enforces the
      // "stay hidden post-defeat" invariant against future writers that
      // might flip visible back to true.
      if (banditDefeatedRef.current) return;
      const icon = drawnRef.current.banditIcon;
      const sprite = drawnRef.current.banditSprite;
      if (icon) icon.alpha = 1;
      if (sprite) sprite.alpha = 1;
    };

    if (!shouldPulseBandit) {
      resetBanditAlpha();
      return;
    }

    const onTick = () => {
      // Yield bandit alpha ownership to the combat vignette while it's active.
      // Without this guard, the pulse keeps writing alpha every frame AFTER the
      // vignette ticker, silently nullifying the success-outcome fade-out
      // (opus 4.7 SuperSwarm catch). The vignette window overlaps the pulse
      // window when banditTicksUntil ∈ [0, 2].
      if (combatVignetteRef.current) return;
      // Defeated bandit stays hidden — don't pulse it back into visibility.
      if (banditDefeatedRef.current) return;
      const icon = drawnRef.current.banditIcon;
      const sprite = drawnRef.current.banditSprite;
      const t = performance.now() / 220;
      const a = 0.55 + 0.45 * Math.abs(Math.sin(t));
      if (icon) icon.alpha = a;
      if (sprite) sprite.alpha = a;
    };
    app.ticker.add(onTick);
    return () => {
      app.ticker.remove(onTick);
      resetBanditAlpha();
    };
  }, [pixiReady, shouldPulseBandit]);

  // Speech bubbles (PR #43): spawn bubbles for new logs; attribute each to a clan via string match.
  // Only active in DEMO_MODE (MOCK_CLANS provides the attribution table).
  useEffect(() => {
    if (!pixiReady || !DEMO_MODE || !bubbleLayerRef.current || logs.length === 0) return;
    const layer = bubbleLayerRef.current;

    // useAgentLogs returns desc order. Reverse so chronological add → newest stacked on top.
    const ordered: AgentLog[] = [...logs].reverse();
    for (const log of ordered) {
      if (seenLogIdsRef.current.has(log._id)) continue;
      seenLogIdsRef.current.add(log._id);

      const clanId = attributeClan(log.message);
      if (!clanId) continue; // skip unattributable logs (rather than corner-clutter)

      const msg = log.message.slice(0, 240);
      const clanColor = MOCK_CLANS.find(c => c.id === clanId)?.color ?? 0xcccccc;
      const handle = makeBubble(msg, clanId, clanColor);
      layer.addChild(handle.container);

      const list = bubblesByClanRef.current.get(clanId) ?? [];
      list.push(handle);
      while (list.length > MAX_BUBBLES_PER_CLAN) {
        const dead = list.shift();
        if (dead) {
          layer.removeChild(dead.container);
          dead.container.destroy({ children: true });
        }
      }
      bubblesByClanRef.current.set(clanId, list);
    }
  }, [logs, pixiReady]);

  // ---- Worker travel (PR #44): spawn dots from log "send X to Y" + canned demos
  function spawnTravel(fromRegionKey: string, toRegionKey: string, color: number, clanId?: string) {
    const layer = travelLayerRef.current;
    if (!layer) return;
    if (fromRegionKey === toRegionKey) return;
    if (travelsRef.current.length >= MAX_DECORATIVE_TRAVELS) return;
    const from = REGIONS.find(r => r.id === fromRegionKey);
    const to = REGIONS.find(r => r.id === toRegionKey);
    if (!from || !to) return;

    // Prefer the clansman sprite. If the texture is still loading, draw a dot
    // briefly and upgrade this same node in place as soon as the PNG arrives.
    const tex = clanId ? clansmanTextureCache[clanId] : undefined;
    const gfx = new Container();
    const carry = makeCarryIndicator();
    carry.container.y = tex ? -18 : -TRAVEL_DOT_RADIUS - 6;
    let body: Container | null = null;
    const installBody = (texture: import('pixi.js').Texture | undefined) => {
      if (body) {
        body.parent?.removeChild(body);
        body.destroy({ children: true });
      }
      if (texture) {
        const sprite = new Sprite(texture);
        sprite.anchor.set(0.5, 0.5);
        const targetH = 28;
        const ratio = targetH / sprite.texture.height;
        sprite.height = targetH;
        sprite.width = sprite.texture.width * ratio;
        body = sprite;
      } else {
        const dot = new Graphics();
        dot.circle(0, 0, TRAVEL_DOT_RADIUS);
        dot.fill({ color });
        dot.stroke({ color: 0x000000, width: 1, alpha: 0.55 });
        body = dot;
      }
      gfx.addChildAt(body, 0);
    };
    installBody(tex);
    if (!tex && clanId) {
      const clansmanPng = clansmanPngForClanId(clanId);
      if (clansmanPng) {
        loadClansmanTexture(clanId, clansmanPng)
          .then((texture) => {
            if (!isMountedRef.current || !travelsRef.current.some((travel) => travel.gfx === gfx)) return;
            installBody(texture);
            carry.container.y = -18;
          })
          .catch(() => {
            // Dot fallback stays visible.
          });
      }
    }
    gfx.alpha = 0;
    gfx.eventMode = 'static';
    gfx.cursor = 'pointer';
    gfx.on('pointertap', (event) => {
      event.stopPropagation();
      if (selectTarget(gfx as SelectableTarget, color)) {
        setSelectedClanId(null);
      }
    });
    gfx.addChild(carry.container);

    travelIdSeqRef.current += 1;
    const id = `travel-${travelIdSeqRef.current}`;
    const route = makeRoute(fromRegionKey, toRegionKey, color, `${clanId ?? 'demo'}:${id}`);
    layer.addChild(route.line);
    layer.addChild(gfx);
    travelsRef.current.push({
      id,
      clanId,
      fromRegionKey,
      toRegionKey,
      startedAt: performance.now(),
      durationMs: OPTIMISTIC_TRAVEL_MS,
      color,
      gfx,
      carry,
      route,
    });
  }

  // Real travels: parse "send X to Y" out of new log messages (demo mode only)
  useEffect(() => {
    if (!pixiReady || !DEMO_MODE || !travelLayerRef.current || logs.length === 0) return;
    const ordered: AgentLog[] = [...logs].reverse();
    for (const log of ordered) {
      if (seenTravelLogIdsRef.current.has(log._id)) continue;
      seenTravelLogIdsRef.current.add(log._id);

      const dest = parseTravelDestination(log.message);
      if (!dest) continue;
      const clanId = attributeClan(log.message);
      const clan = clanId ? MOCK_CLANS.find(c => c.id === clanId) : null;
      if (!clan) continue;
      if (clan.homeRegion === dest) continue;
      spawnTravel(clan.homeRegion, dest, clan.color, clan.id);
    }
  }, [logs, pixiReady]);

  // Pixel burst trigger: watch agentLogs for deposit and trade events,
  // spawn a pixel burst at the appropriate world position.
  useEffect(() => {
    if (!pixiReady) return;
    const { scaleX, scaleY, offsetX, offsetY } = layoutRef.current;
    const projX = (nx: number) => offsetX + nx * REF_W * scaleX;
    const projY = (ny: number) => offsetY + ny * REF_H * scaleY;
    const unicornRegion = REGIONS.find(r => r.id === 'unicorn-town');

    for (const log of logs) {
      if (seenBurstLogIdsRef.current.has(log._id)) continue;
      seenBurstLogIdsRef.current.add(log._id);
      const msg = log.message.toLowerCase();

      // Deposit burst at the clan's base
      if (/\bdeposit\b/.test(msg)) {
        const clanId = attributeClan(log.message);
        const anchor = clanId ? flagAnchorsRef.current.get(clanId) : null;
        if (anchor) {
          const clan = MOCK_CLANS.find(c => c.id === clanId);
          triggerPixelBurst(anchor.x, anchor.y - 8, clan?.color ?? 0xe8d8b5, 14);
        }
      }

      // Trade burst at Unicorn Town
      if (/\b(unicorn\s*town|market|trade(?:d|s)?|sell|buy)\b/.test(msg) && unicornRegion) {
        const ux = projX(unicornRegion.nx);
        const uy = projY(unicornRegion.ny);
        triggerPixelBurst(ux, uy, 0xcc88cc, 18);
      }
    }
  }, [logs, pixiReady]);

  // Canned demo travels: continuous spawn so 4-8 dots are always in motion.
  // Hackathon visual: the map should never feel dead. Skipped when DEMO_MODE is off.
  useEffect(() => {
    if (!pixiReady || !DEMO_MODE) return;
    const fireOne = () => {
      const clan = MOCK_CLANS[Math.floor(Math.random() * MOCK_CLANS.length)];
      if (!clan) return;
      const candidates = REGIONS.filter(r => r.id !== clan.homeRegion);
      const dest = candidates[Math.floor(Math.random() * candidates.length)];
      if (!dest) return;
      spawnTravel(clan.homeRegion, dest.id, clan.color, clan.id);
    };
    // Initial burst — one worker from EACH clan, staggered so they're visible
    // immediately when the canvas loads. Track timeout IDs so we can cancel
    // them on unmount (PR #133 review MUST FIX #2 — without this, callbacks
    // fire after Pixi teardown and call spawnTravel on destroyed objects).
    const staggerIds = MOCK_CLANS.map((clan, i) =>
      window.setTimeout(() => {
        const candidates = REGIONS.filter(r => r.id !== clan.homeRegion);
        const dest = candidates[Math.floor(Math.random() * candidates.length)];
        if (!dest) return;
        spawnTravel(clan.homeRegion, dest.id, clan.color, clan.id);
      }, i * 250),
    );
    const interval = window.setInterval(fireOne, CANNED_TRAVEL_INTERVAL_MS);
    return () => {
      staggerIds.forEach(id => window.clearTimeout(id));
      window.clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pixiReady]);

  if (pixiInitError) {
    throw pixiInitError;
  }
  if (webglLost) {
    throw new Error('WebGL context lost — tap to reload');
  }

  // ---- Scoreboard data: live snapshot if present, else mock metadata -------
  // Portrait + archetype label come from MOCK_CLANS (they are static metadata,
  // not server state) — we look them up by clan id whether the row is sourced
  // from a live snapshot or the mock fallback.
  // When DEMO_MODE is off, scoreboardClans is empty — the scoreboard panel hides
  // and the "no chain data yet" placeholder is shown instead.
  const scoreboardClans = useMemo(() => {
    const live = snapshot?.clans as SnapshotClan[] | undefined;
    if (live && live.length > 0) {
      const visualById = new Map(liveClansToVisualClans(live).map((clan) => [clan.id, clan]));
      return live
        .map(c => {
          const meta = visualById.get(c.id);
          return {
            id: c.id,
            name: meta?.name ?? c.name,
            color: meta?.color ?? 0xcccccc,
            portrait: meta?.portrait ?? '',
            archetype: meta?.archetype ?? '',
            monumentLevel: c.baseLevel ?? c.monumentLevel ?? treasuryToMonument(c.treasury),
            gold: resourceUnits(c.goldBalance),
            vaultWood: resourceUnits(c.vaultWood),
            vaultIron: resourceUnits(c.vaultIron),
            vaultWheat: resourceUnits(c.vaultWheat),
            vaultFish: resourceUnits(c.vaultFish),
          };
        })
        .sort((a, b) => b.monumentLevel - a.monumentLevel);
    }
    // Mock fallback — only used in DEMO_MODE
    if (DEMO_MODE) {
      // Static demo numbers so the resource readout reads sensibly without chain data.
      const mockVaults: Array<{ gold: number; wood: number; iron: number; wheat: number; fish: number }> = [
        { gold: 12, wood: 24, iron: 6, wheat: 18, fish: 4 },
        { gold: 8,  wood: 15, iron: 12, wheat: 9,  fish: 2 },
        { gold: 5,  wood: 9,  iron: 3,  wheat: 22, fish: 1 },
        { gold: 3,  wood: 6,  iron: 2,  wheat: 11, fish: 14 },
      ];
      return MOCK_CLANS.map((c, i) => {
        const v = mockVaults[i] ?? mockVaults[0]!;
        return {
          id: c.id,
          name: c.name,
          color: c.color,
          portrait: c.portrait,
          archetype: c.archetype,
          monumentLevel: 4 - i,
          gold: v.gold,
          vaultWood: v.wood,
          vaultIron: v.iron,
          vaultWheat: v.wheat,
          vaultFish: v.fish,
        };
      }).sort((a, b) => b.monumentLevel - a.monumentLevel);
    }
    return [];
  }, [snapshot]);

  return (
    <div
      ref={containerRef}
      style={{
        position: 'relative',
        width: '100%',
        // Fill the parent. We set BOTH `height: 100%` (so grid-cell parents
        // like the cockpit's center cell give us their full row height) AND
        // `flex: 1 1 auto` + min-height:0 (legacy: the standalone
        // /worldmap-only route uses a flex column <main> wrapper). Without
        // height:100%, grid-cell children collapse to content-height (= 0
        // because the inner canvasWrap is absolutely positioned), pixi
        // ResizeObserver reports 0x0, and the canvas renders empty/black.
        height: '100%',
        flex: '1 1 auto',
        minHeight: 0,
        overflow: 'hidden',
      }}
    >
      <div
        ref={canvasWrapRef}
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          // Scope the ghost/canvas z-index stacking to this container so it
          // cannot compete with grand-sibling overlays (HUD, scoreboard, etc).
          isolation: 'isolate',
        }}
      >
        {/* Static HTML "ghost" of the map — visible briefly while PixiJS
            warms up WebGL (~500ms-1s on cold mobile Safari). Renders the
            cached map background + clan bases using the same viewport
            (cx, cy, scale) state pixi-viewport already persists. Fades
            out once `pixiReady` flips true.
            See: apps/web/src/components/MapGhostLayer.tsx. */}
        <MapGhostLayer pixiReady={pixiReady} />
      </div>

      {/* Top HUD bar — tick clock, season progress, status chips */}
      <TopHud liveTick={liveTick} />

      {/* Event ticker — scrolling live game events */}
      <EventTicker />

      {/* Compact world-pulse panel — top-left, semi-transparent.
          Default: tick + per-clan IG/EH/... level summary.
          When a clan base is selected: switches to a per-clan resource readout
          (gold + four vaults) for that clan. Click a non-base target or press
          Escape to clear and revert to the default view.
          Shown whenever scoreboardClans is non-empty (demo mock data OR live snapshot). */}
      {scoreboardClans.length > 0 && (() => {
        const selectedClan = selectedClanId
          ? scoreboardClans.find((c) => c.id === selectedClanId) ?? null
          : null;
        return (
          <div
            style={{
              position: 'absolute',
              top: 52,
              left: 8,
              padding: '5px 8px',
              background: 'rgba(13, 26, 13, 0.7)',
              border: `1px solid ${selectedClan ? hex(selectedClan.color) : 'rgba(204, 170, 34, 0.35)'}`,
              borderRadius: 5,
              fontFamily: 'monospace',
              color: '#e8e2c8',
              fontSize: 10,
              lineHeight: 1.3,
              boxShadow: '0 2px 6px rgba(0,0,0,0.35)',
              pointerEvents: 'none',
              zIndex: 2,
              maxWidth: '70%',
            }}
          >
            {selectedClan ? (
              <>
                <div style={{ color: hex(selectedClan.color), fontWeight: 700, letterSpacing: '0.05em' }}>
                  {selectedClan.name}
                  <span style={{ marginLeft: 8, color: '#e8d68f', fontWeight: 600 }}>
                    Lv {selectedClan.monumentLevel}
                  </span>
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', opacity: 0.95 }}>
                  <span>gold {selectedClan.gold}</span>
                  <span>wood {selectedClan.vaultWood}</span>
                  <span>iron {selectedClan.vaultIron}</span>
                  <span>wheat {selectedClan.vaultWheat}</span>
                  <span>fish {selectedClan.vaultFish}</span>
                </div>
              </>
            ) : (
              <>
                <div style={{ color: '#e8d68f', fontWeight: 600, letterSpacing: '0.05em' }}>
                  tick {liveTick}
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', opacity: 0.85 }}>
                  {scoreboardClans.map((c) => {
                    const initials =
                      c.name === 'Iron Guard' ? 'IG'
                        : c.name === 'Ember Hand' ? 'EH'
                        : c.name === 'Dawn Watch' ? 'DW'
                        : c.name === 'Storm Riders' ? 'SR'
                        : c.name.slice(0, 2).toUpperCase();
                    return (
                      <span key={c.id} style={{ color: hex(c.color), whiteSpace: 'nowrap' }}>
                        {initials} L{c.monumentLevel}
                      </span>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        );
      })()}

      {/* "No chain data yet" placeholder — shown when DEMO_MODE is off and no
          snapshot clans are present, *after* a 5-second grace period managed
          by `showNoChainDataPlaceholder` (see the useEffect declared with the
          snapshot hooks above). Centered overlay so it reads clearly on the
          bare terrain map. */}
      {!DEMO_MODE && showNoChainDataPlaceholder && (
        <div
          data-testid="no-chain-data-placeholder"
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            pointerEvents: 'none',
            zIndex: 3,
          }}
        >
          <div
            style={{
              padding: '16px 28px',
              background: 'rgba(13, 26, 13, 0.82)',
              border: '1px solid rgba(204, 170, 34, 0.4)',
              borderRadius: 8,
              fontFamily: '"Cinzel", "Times New Roman", serif',
              color: '#e8d68f',
              fontSize: 15,
              letterSpacing: '0.07em',
              boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
              textAlign: 'center',
            }}
          >
            no chain data yet
          </div>
        </div>
      )}

      {/* World-level notice parchment — bottom-center, surfaces warn-level
          WORLD events (bandits, raids, weather). Distinct from per-clan
          speech bubbles. */}
      <WorldNoticePanel />

      {/* Build-version badge — top-right corner. Source: VITE_APP_VERSION
          baked at build time from the release tag. See issue #312. */}
      <VersionBadge />
    </div>
  );
}

/**
 * Build one speech bubble (PR #43, tail-rework PR for hackathon).
 * Container origin = the anchor on the base sprite (= tip of the tail).
 * Backdrop is drawn ABOVE the origin; tail points down to (0, 0).
 *
 * The tail is a separate Graphics object so the ticker can hide it on
 * stacked (non-bottom) bubbles. Tail uses clan color + thick white outline
 * so it's clearly visible against dark/textured backgrounds and visually
 * attributes the bubble to its base.
 */
function makeBubble(message: string, clanId: string, clanColor: number): BubbleHandle {
  const container = new Container();
  container.alpha = 0;

  // Split on first ": " — header (e.g. "Iron Guard Elder") gets distinct styling
  // (bold, clan-colored, Cinzel) above the orders body. Fall back to single-line
  // rendering if the message has no header separator.
  const splitIdx = message.indexOf(': ');
  const hasHeader = splitIdx > 0;
  const header = hasHeader ? message.slice(0, splitIdx) : '';
  const body = hasHeader ? message.slice(splitIdx + 2) : message;

  const wrapWidth = BUBBLE_MAX_WIDTH - BUBBLE_PAD_X * 2;
  const HEADER_BODY_GAP = 2;

  const headerText = hasHeader
    ? new Text({
        text: header,
        style: {
          fill: clanColor,
          fontSize: 13,
          fontFamily: '"Cinzel", "Times New Roman", serif',
          fontWeight: 'bold',
          wordWrap: true,
          wordWrapWidth: wrapWidth,
          lineHeight: 16,
        },
      })
    : null;

  const bodyText = new Text({
    text: body,
    style: {
      fill: 0xfff5e0,
      fontSize: 12,
      fontFamily: 'monospace',
      wordWrap: true,
      wordWrapWidth: wrapWidth,
      lineHeight: 15,
    },
  });

  const headerW = headerText ? Math.min(headerText.width, wrapWidth) : 0;
  const headerH = headerText ? headerText.height : 0;
  const bodyW = Math.min(bodyText.width, wrapWidth);
  const bodyH = bodyText.height;

  const textW = Math.max(headerW, bodyW);
  const textH = headerText ? headerH + HEADER_BODY_GAP + bodyH : bodyH;
  const w = textW + BUBBLE_PAD_X * 2;
  const h = textH + BUBBLE_PAD_Y * 2;

  const tailH = BUBBLE_TAIL_HEIGHT;
  const backdrop = new Graphics();
  const bx = -w / 2;
  const by = -h - tailH;
  backdrop.roundRect(bx, by, w, h, BUBBLE_CORNER);
  backdrop.fill({ color: BUBBLE_FILL, alpha: BUBBLE_FILL_ALPHA });
  backdrop.stroke({ color: clanColor, width: 1.5, alpha: 0.85 });

  container.addChild(backdrop);

  // Tail: clan-colored fill with thick white outline. Drawn as a separate
  // Graphics so the ticker can hide it on non-bottom (stacked) bubbles —
  // upper-stack tails would point to empty air and look broken.
  const tail = new Graphics();
  // Triangle: top edge sits flush with backdrop bottom (y = -tailH),
  // tip at (0, 0) which is the anchor on the base sprite.
  tail.moveTo(-BUBBLE_TAIL_HALF_WIDTH, -tailH);
  tail.lineTo(BUBBLE_TAIL_HALF_WIDTH, -tailH);
  tail.lineTo(0, 0);
  tail.closePath();
  tail.fill({ color: clanColor, alpha: 1 });
  tail.stroke({ color: BUBBLE_TAIL_OUTLINE, width: BUBBLE_TAIL_OUTLINE_WIDTH, alpha: 1 });
  container.addChild(tail);

  if (headerText) {
    headerText.x = bx + BUBBLE_PAD_X;
    headerText.y = by + BUBBLE_PAD_Y;
    container.addChild(headerText);
    bodyText.x = bx + BUBBLE_PAD_X;
    bodyText.y = by + BUBBLE_PAD_Y + headerH + HEADER_BODY_GAP;
  } else {
    bodyText.x = bx + BUBBLE_PAD_X;
    bodyText.y = by + BUBBLE_PAD_Y;
  }
  container.addChild(bodyText);

  return {
    container,
    bornAt: performance.now(),
    lifeMs: FADE_IN_MS + HOLD_MS + FADE_OUT_MS,
    height: h + tailH,
    clanId,
    tail,
  };
}
