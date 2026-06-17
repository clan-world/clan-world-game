/**
 * Shared environment-flag exports for `apps/web`.
 *
 * Why this file exists: previously `WorldMap.tsx` imported `DEMO_MODE` from
 * `./App`, while `App.tsx` (transitively, via `MainApp`) imported `WorldMap`.
 * That created a module cycle — bundlers can return undefined bindings during
 * initialization, and tests can't isolate either module without dragging the
 * other in. PR #133 review MUST FIX #3.
 *
 * Rule: env flags read at module-init time live here. Components import from
 * `./config/env` (a leaf module) — never from another component file.
 */

/**
 * DEMO_MODE — gates all mock/fake data in WorldMap.
 *
 * - true  (VITE_CLANWORLD_DEMO_MODE=true): render mock clans, bandits, walls,
 *   monuments, agentLogs. Set explicitly for local demo/UAT visibility,
 *   hackathon Loom recordings, or judges-without-World-App preview.
 * - false (env unset OR any value other than 'true'): canvas + scoreboard ONLY
 *   render real Convex/chain state. Empty world = empty UI.
 *
 * Default policy: missing/unset env var → DEMO_MODE off (false). Only an
 * explicit `'true'` string enables it.
 */
export const DEMO_MODE = import.meta.env.VITE_CLANWORLD_DEMO_MODE === 'true';

/**
 * CAPTURE_MODE — presentation-only mode for authored hero-video capture.
 *
 * Enabled via the URL query param `?capture=1` (read once at module init), so
 * the SAME bundle serves both the live demo cockpit and the capture harness —
 * no separate build. CAPTURE_MODE must ONLY ever change *presentation*
 * (camera, ambient lighting, hiding admin/interaction chrome). It must never
 * touch game logic or data.
 *
 * What it gates (see WorldMap.tsx):
 * - exposes `window.__cwCapture` (viewport handle + world dims + a ready flag)
 *   so the Playwright harness can drive a scripted cinematic camera;
 * - drops the drag/pinch/wheel/decelerate/clampZoom interaction plugins and the
 *   sessionStorage viewport-restore so nothing fights the scripted camera;
 * - re-enables the day/night lighting sweep for cinematic warmth.
 */
export const CAPTURE_MODE =
  typeof window !== 'undefined' &&
  new URLSearchParams(window.location.search).get('capture') === '1';
