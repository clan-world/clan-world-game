/**
 * Boundary tests for resetOverlayState — covers all four discriminated values
 * of `TerminalFrameStatus` and pins the elder-id format so a string-template
 * refactor surfaces as a test failure (the id is used as a React key and as
 * a DOM selector in Playwright tests under tests/e2e).
 *
 * Authored by Agent B in the 2026-05-24 parallel test-improvement experiment.
 * Approach: BOUNDARY CONDITIONS — every discrete enum value, plus invariants
 * on the overlay-window constants (must be positive, fade < max-display).
 */
import { describe, expect, it } from 'vitest';
import type { TerminalFrameStatus } from '../../hooks/useTerminalFrameReconnect';
import {
  RESET_DETECTION_WINDOW_MS,
  RESET_OVERLAY_FADE_MS,
  RESET_OVERLAY_MAX_DISPLAY_MS,
  getElderResetId,
  shouldCheckForReset,
} from './resetOverlayState';

describe('shouldCheckForReset — every TerminalFrameStatus enum value', () => {
  // Test the full enum surface so adding a new status without updating this
  // predicate is caught. Boundary case: a typo'd status (`'reconect'`) would
  // silently never trigger reset detection in production.

  it.each<{ status: TerminalFrameStatus; expected: boolean }>([
    { status: 'connecting',   expected: false },
    { status: 'connected',    expected: false },
    { status: 'reconnecting', expected: true  },
    { status: 'disconnected', expected: true  },
  ])('status="$status" → $expected', ({ status, expected }) => {
    expect(shouldCheckForReset(status)).toBe(expected);
  });
});

describe('getElderResetId — boundary clan ids', () => {
  it('formats the expected `elder-${id}` shape for normal ids (1..5)', () => {
    expect(getElderResetId(1)).toBe('elder-1');
    expect(getElderResetId(5)).toBe('elder-5');
  });

  it('handles clanId = 0 (defensive fallback during indexing)', () => {
    // Snapshot data CAN momentarily include clanId=0 during convex hydration.
    // The id must still be a string (used as React key + DOM selector) and
    // must not contain "undefined" or "NaN".
    const id = getElderResetId(0);
    expect(typeof id).toBe('string');
    expect(id).toBe('elder-0');
    expect(id).not.toContain('undefined');
  });

  it('handles negative / huge clanIds without losing the prefix', () => {
    // Boundary: ensure the function template-literal'd correctly (a refactor
    // to `elder-${String(clanId)}` would still pass these but a refactor to
    // `getElderResetId(clanId.toFixed(0))` would silently truncate negatives.
    expect(getElderResetId(-1)).toBe('elder--1');
    expect(getElderResetId(Number.MAX_SAFE_INTEGER)).toBe(
      `elder-${Number.MAX_SAFE_INTEGER}`,
    );
  });
});

describe('reset overlay window constants — invariants', () => {
  // These three constants gate UX timing of the reset overlay: a regression
  // that makes the overlay never fade out (FADE_MS > MAX_DISPLAY_MS) or never
  // appear (FADE_MS = 0) would be invisible in CI but obvious in production.

  it('all three timing constants are positive finite numbers', () => {
    expect(RESET_DETECTION_WINDOW_MS).toBeGreaterThan(0);
    expect(RESET_OVERLAY_MAX_DISPLAY_MS).toBeGreaterThan(0);
    expect(RESET_OVERLAY_FADE_MS).toBeGreaterThan(0);
    expect(Number.isFinite(RESET_DETECTION_WINDOW_MS)).toBe(true);
    expect(Number.isFinite(RESET_OVERLAY_MAX_DISPLAY_MS)).toBe(true);
    expect(Number.isFinite(RESET_OVERLAY_FADE_MS)).toBe(true);
  });

  it('FADE_MS is strictly less than MAX_DISPLAY_MS (otherwise overlay never settles)', () => {
    // If FADE_MS >= MAX_DISPLAY_MS the fade-out would never complete inside
    // the display window — the overlay would either pop out or get clipped.
    expect(RESET_OVERLAY_FADE_MS).toBeLessThan(RESET_OVERLAY_MAX_DISPLAY_MS);
  });

  it('MAX_DISPLAY is at least as long as the detection window (else we miss the reset)', () => {
    // The detection window is the time we have to spot the reset; the
    // overlay must stay up at least that long so the user sees it.
    expect(RESET_OVERLAY_MAX_DISPLAY_MS).toBeGreaterThanOrEqual(RESET_DETECTION_WINDOW_MS);
  });
});
