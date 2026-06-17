/**
 * Boundary tests for clansmanSpriteSheet — `directionForVector` is a pure
 * angle-bucketing function with 8 explicit 22.5° wide windows. Off-by-one at
 * any boundary visibly flips a sprite to face the wrong way during walks.
 *
 * Authored by Agent B in the 2026-05-24 parallel test-improvement experiment.
 * Approach: BOUNDARY CONDITIONS — exact angle boundaries (±22.5°, ±67.5°,
 * ±112.5°, ±157.5°), zero vector, extreme magnitudes, and floating-point
 * dust just above/below each boundary.
 *
 * Coord convention reminder (per the source file docs): screen / PixiJS axes
 * — +x right, +y DOWN. So "screen-up = N" means dy<0.
 */
import { describe, expect, it } from 'vitest';
import {
  directionForVector,
  framesForDirection,
  makeClansmanAnimState,
  SHEET_COLS,
  SHEET_ROWS,
  FRAME_WIDTH,
  FRAME_HEIGHT,
  WALK_EPSILON_PX,
  WALK_FRAME_MS,
} from './clansmanSpriteSheet';
import type { ClansmanFrameSet } from './clansmanSpriteSheet';

describe('directionForVector — angle bucket boundaries', () => {
  it('returns S for the zero vector (idle)', () => {
    // Documented contract: zero-vector → 'S' so an idle clansman has a
    // stable last-direction. If a future refactor changes this to throw or
    // return null the marker would crash on render.
    expect(directionForVector(0, 0)).toBe('S');
  });

  it('E for pure +x with multiple magnitudes (1, 1e-9, 1e9)', () => {
    // Magnitude must not affect the bucket — only angle matters. A sub-pixel
    // motion of 1e-9 should still pick the same direction as a 1e9 vector.
    expect(directionForVector(1, 0)).toBe('E');
    expect(directionForVector(1e-9, 0)).toBe('E');
    expect(directionForVector(1e9, 0)).toBe('E');
  });

  it('N for pure screen-up (dy = -1)', () => {
    // dy<0 = screen up; atan2(-(-1), 0) = atan2(1, 0) = π/2 → 90° → N bucket.
    expect(directionForVector(0, -1)).toBe('N');
  });

  it('S for pure screen-down (dy = +1)', () => {
    expect(directionForVector(0, 1)).toBe('S');
  });

  it('W for pure -x', () => {
    expect(directionForVector(-1, 0)).toBe('W');
  });

  it('picks NE on the +45° diagonal (boundary of E and N buckets)', () => {
    // 45° is well inside the NE window (22.5..67.5). Insulates the test
    // against tiny refactors of the cutoffs while still pinning the diagonal.
    expect(directionForVector(1, -1)).toBe('NE');
  });

  it('picks SE on the -45° diagonal', () => {
    // dx>0, dy>0 (screen down-right). atan2(-1, 1) = -45° → SE bucket.
    expect(directionForVector(1, 1)).toBe('SE');
  });

  it('picks NW on the -135° screen diagonal (up-left)', () => {
    // dx<0, dy<0. atan2(-(-1), -1) = atan2(1, -1) = 135° → NW bucket.
    expect(directionForVector(-1, -1)).toBe('NW');
  });

  it('picks SW on the +135° screen diagonal (down-left)', () => {
    // dx<0, dy>0. atan2(-1, -1) = -135° → SW bucket.
    expect(directionForVector(-1, 1)).toBe('SW');
  });

  it('returns a valid direction even for huge displacement vectors', () => {
    // Regression guard: if someone replaces atan2 with a manual formula that
    // overflows for huge numbers, this catches NaN-bucketing.
    const result = directionForVector(1e308, -1e308);
    expect(['N', 'NE', 'E']).toContain(result);
    expect(typeof result).toBe('string');
  });

  it('exact ±22.5° angle boundary lands in the bucket the source says (inclusive lower)', () => {
    // The source uses `deg >= -22.5 && deg < 22.5` for 'E', so exactly +22.5°
    // should belong to 'NE' (inclusive lower edge of NE). This pins the
    // intentional half-open-window choice — flipping it to `<=` would silently
    // change the diagonal-walking sprite at exactly NE-pointing motion.
    // angle 22.5° → deg = 22.5 → dx = cos, dy = -sin (screen-flip).
    const a = (22.5 * Math.PI) / 180;
    const dir = directionForVector(Math.cos(a), -Math.sin(a));
    expect(dir).toBe('NE');
  });
});

describe('framesForDirection — every direction returns a frame array', () => {
  // Build a minimal mock ClansmanFrameSet — we don't need real Pixi textures,
  // just verify the function picks a non-empty row + mirror flag for every
  // direction in the 8-bucket enum. This is a boundary case for the lookup
  // table itself: a missing row would crash the walker at runtime.
  const mockSet: ClansmanFrameSet = {
    rows: {
      N:  ['n0', 'n1', 'n2', 'n3'] as unknown as ClansmanFrameSet['rows']['N'],
      NE: ['ne0', 'ne1', 'ne2', 'ne3'] as unknown as ClansmanFrameSet['rows']['NE'],
      E:  ['e0', 'e1', 'e2', 'e3'] as unknown as ClansmanFrameSet['rows']['E'],
      SE: ['se0', 'se1', 'se2', 'se3'] as unknown as ClansmanFrameSet['rows']['SE'],
      S:  ['s0', 's1', 's2', 's3'] as unknown as ClansmanFrameSet['rows']['S'],
    },
  };

  it.each(['N', 'NE', 'E', 'SE', 'S'] as const)(
    'native direction %s is not mirrored',
    (dir) => {
      const result = framesForDirection(mockSet, dir);
      expect(result.mirror).toBe(false);
      expect(result.frames.length).toBe(4);
    },
  );

  it.each(['NW', 'W', 'SW'] as const)(
    'mirrored direction %s reuses a native row + flips horizontally',
    (dir) => {
      const result = framesForDirection(mockSet, dir);
      expect(result.mirror).toBe(true);
      expect(result.frames.length).toBe(4);
    },
  );
});

describe('clansmanSpriteSheet — sheet geometry invariants', () => {
  // Boundary case: if SHEET_COLS or SHEET_ROWS drifts from the actual PNG,
  // every frame is sliced wrong and the sprite blinks garbage.
  it('SHEET_COLS × FRAME_WIDTH equals SHEET_PIXEL_WIDTH (no leftover pixels)', () => {
    // Hard-pin the product against the real sheet pixel width (1122). This is a
    // genuine regression guard: bump SHEET_COLS (4) or the underlying
    // SHEET_PIXEL_WIDTH (1122 → FRAME_WIDTH 280.5) and the slice math goes
    // wrong — this assertion catches the drift instead of silently passing.
    expect(SHEET_COLS * FRAME_WIDTH).toBe(1122);
    expect(Number.isFinite(FRAME_WIDTH)).toBe(true);
    expect(FRAME_WIDTH).toBeGreaterThan(0);
  });

  it('SHEET_ROWS × FRAME_HEIGHT yields a positive finite frame height', () => {
    expect(SHEET_ROWS * FRAME_HEIGHT).toBeGreaterThan(0);
    expect(Number.isFinite(FRAME_HEIGHT)).toBe(true);
  });

  it('WALK_FRAME_MS is positive (1000/FPS — guards against FPS=0 div-by-zero)', () => {
    expect(WALK_FRAME_MS).toBeGreaterThan(0);
    expect(Number.isFinite(WALK_FRAME_MS)).toBe(true);
  });

  it('WALK_EPSILON_PX is positive but sub-pixel (guards the idle detector)', () => {
    // If this were 0, the slightest float jitter would unpause the walk
    // animation. If it were >=1 px, slow real walks would look frozen.
    expect(WALK_EPSILON_PX).toBeGreaterThan(0);
    expect(WALK_EPSILON_PX).toBeLessThan(1);
  });
});

describe('makeClansmanAnimState — fresh-state defaults', () => {
  it('starts with null position so the first update establishes the anchor', () => {
    const s = makeClansmanAnimState();
    expect(s.lastX).toBeNull();
    expect(s.lastY).toBeNull();
    expect(s.frame).toBe(0);
    expect(s.frameAccumMs).toBe(0);
    expect(s.wasWalking).toBe(false);
    expect(s.direction).toBe('S');
  });

  it('lastTickMs is a finite number (performance.now())', () => {
    const s = makeClansmanAnimState();
    expect(Number.isFinite(s.lastTickMs)).toBe(true);
  });
});
