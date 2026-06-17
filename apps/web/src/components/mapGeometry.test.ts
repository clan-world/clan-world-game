/**
 * Boundary tests for mapGeometry — focused on the stepwise `baseVisualScale`
 * level function and the readonly lookup tables (region centers + base PNGs)
 * that downstream layers rely on. These are read by both WorldMap.tsx (Pixi
 * canvas) and MapGhostLayer.tsx (static ghost) — disagreement causes a visible
 * pop on map mount, so the boundaries here are visual-correctness boundaries.
 *
 * Authored by Agent B in the 2026-05-24 parallel test-improvement experiment.
 * Approach: BOUNDARY CONDITIONS — extreme + edge values for numeric inputs.
 */
import { describe, expect, it } from 'vitest';
import {
  BASE_PNG_BY_VISUAL_INDEX,
  FALLBACK_HOME_REGION_BY_INDEX,
  LIVE_CLAN_REGION_BY_ID,
  MAP_HEIGHT,
  MAP_WIDTH,
  REGION_CENTERS_BY_KEY,
  baseVisualScale,
} from './mapGeometry';

describe('baseVisualScale — stepwise level → scalar', () => {
  // The function source (mapGeometry.ts) explicitly documents:
  //   "Levels 1-2 → 0.675, 3-4 → 0.81, 5 → 0.9"
  // Boundary risks: off-by-one at each step (level==2 vs level==3, level==4
  // vs level==5), and undocumented behaviour at <=0 / >5 / fractional.

  it('returns small scale (0.675) at level 1 — lower documented bound', () => {
    expect(baseVisualScale(1)).toBe(0.675);
  });

  it('returns small scale (0.675) at level 2 — upper edge of step 1', () => {
    expect(baseVisualScale(2)).toBe(0.675);
  });

  it('jumps to mid scale (0.81) at level 3 — step boundary', () => {
    // If `<=` were `<` this would regress to 0.675 — boundary-pinning assertion.
    expect(baseVisualScale(3)).toBe(0.81);
  });

  it('returns mid scale (0.81) at level 4 — upper edge of step 2', () => {
    expect(baseVisualScale(4)).toBe(0.81);
  });

  it('jumps to large scale (0.9) at level 5 — final documented step', () => {
    expect(baseVisualScale(5)).toBe(0.9);
  });

  it('clamps high levels (6, 10, 1000) to the largest documented scale', () => {
    // The current implementation is open-ended above 4 (returns 0.9). Pin that
    // so a future bug like `level === 5 ? 0.9 : ???` is caught.
    expect(baseVisualScale(6)).toBe(0.9);
    expect(baseVisualScale(10)).toBe(0.9);
    expect(baseVisualScale(1000)).toBe(0.9);
  });

  it('does not crash and returns smallest scale for non-positive levels (0, -1)', () => {
    // Defensive: snapshot data CAN arrive with level=0 during indexing or
    // before any upgrade. The function should still return a real number so
    // PixiJS containers don't get NaN.scale and disappear.
    expect(baseVisualScale(0)).toBe(0.675);
    expect(baseVisualScale(-1)).toBe(0.675);
    expect(Number.isFinite(baseVisualScale(0))).toBe(true);
  });

  it('returns a finite number for fractional levels (1.5, 2.5, 4.001)', () => {
    // Levels are integers in the live game but the function takes `number`.
    // Step is `<=`, so 2.5 falls into the middle band (0.81). Pin actual
    // behaviour so a refactor to floor/ceil is a visible diff.
    expect(baseVisualScale(1.5)).toBe(0.675);
    expect(baseVisualScale(2.5)).toBe(0.81);
    // 4.001 > 4 → falls through both bands → 0.9. Verifies the boundary at
    // level 4 is correctly inclusive (not 4.999 — that's > 4 so goes to 0.9).
    expect(baseVisualScale(4.001)).toBe(0.9);
  });
});

describe('mapGeometry constants — invariants', () => {
  // These constants are NOT recomputed per render and are dereferenced by
  // index inside hot Pixi loops. Empty / wrong-length tables silently break
  // map rendering with no console error — these tests turn that into a
  // unit-test failure on the next regression.

  it('MAP_WIDTH and MAP_HEIGHT are positive finite numbers', () => {
    expect(MAP_WIDTH).toBeGreaterThan(0);
    expect(MAP_HEIGHT).toBeGreaterThan(0);
    expect(Number.isFinite(MAP_WIDTH)).toBe(true);
    expect(Number.isFinite(MAP_HEIGHT)).toBe(true);
  });

  it('REGION_CENTERS_BY_KEY entries all fall within [0, 1] normalised coords', () => {
    // Any entry with nx/ny outside [0,1] would place a region marker off the
    // canvas. Catches typos like dividing by MAP_HEIGHT for the X coordinate.
    for (const [key, { nx, ny }] of Object.entries(REGION_CENTERS_BY_KEY)) {
      expect(nx, `${key} nx`).toBeGreaterThanOrEqual(0);
      expect(nx, `${key} nx`).toBeLessThanOrEqual(1);
      expect(ny, `${key} ny`).toBeGreaterThanOrEqual(0);
      expect(ny, `${key} ny`).toBeLessThanOrEqual(1);
    }
  });

  it('BASE_PNG_BY_VISUAL_INDEX has 5 entries (matches LIVE_CLAN_META in WorldMap)', () => {
    // The visual index goes 0..4 (Iron Guard, Ember Hand, Dawn Watch, Storm
    // Riders, Deployer Keep). Out-of-bounds access returns undefined and
    // PixiJS renders a missing texture box.
    expect(BASE_PNG_BY_VISUAL_INDEX.length).toBe(5);
    BASE_PNG_BY_VISUAL_INDEX.forEach((path, i) => {
      expect(path, `index ${i}`).toMatch(/^\/bases\/.+\.png$/);
    });
  });

  it('FALLBACK_HOME_REGION_BY_INDEX agrees in length with BASE_PNG_BY_VISUAL_INDEX', () => {
    // Defensive: if these drift, a clan with no snapshot baseRegion gets
    // either undefined (crash) or the wrong fallback region.
    expect(FALLBACK_HOME_REGION_BY_INDEX.length).toBe(BASE_PNG_BY_VISUAL_INDEX.length);
  });

  it('every FALLBACK_HOME_REGION_BY_INDEX entry maps to a known region key', () => {
    const knownKeys = new Set(Object.keys(REGION_CENTERS_BY_KEY));
    FALLBACK_HOME_REGION_BY_INDEX.forEach((key, i) => {
      expect(knownKeys.has(key), `fallback[${i}] = ${key}`).toBe(true);
    });
  });

  it('every LIVE_CLAN_REGION_BY_ID value maps to a known region key', () => {
    // Boundary case: shared/generated/constants could rename a REGION_*; the
    // lookup would still type-check (key is a number) but the value string
    // would not exist in REGION_CENTERS_BY_KEY. Catch that drift here.
    const knownKeys = new Set(Object.keys(REGION_CENTERS_BY_KEY));
    for (const [id, key] of Object.entries(LIVE_CLAN_REGION_BY_ID)) {
      expect(knownKeys.has(key), `region id ${id} → ${key}`).toBe(true);
    }
  });
});
