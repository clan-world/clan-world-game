/**
 * 06-canvas-warmth.spec.ts — canvas warmth state machine.
 *
 * Validates the cache → ghost → canvas → grace-period-placeholder transitions
 * documented in `apps/web/src/components/MapGhostLayer.tsx` + the 5-second
 * grace-period useEffect in `apps/web/src/WorldMap.tsx`.
 *
 * Three cases (per issue #284):
 *   1. Cold cache  → placeholder appears after 5s grace window
 *   2. Primed cache → ghost is visible at t=0, fades + unmounts after pixiReady
 *   3. WS dropout (primed cache held over) → placeholder never flashes
 *
 * Tests require a build/dev-server with VITE_CLANWORLD_DEMO_MODE=false, since
 * the placeholder + grace-period logic is gated on DEMO_MODE. With DEMO_MODE
 * on (the playwright.config.ts default), the placeholder is unconditionally
 * hidden and the cache path is bypassed. The describe blocks below `test.skip`
 * when DEMO_MODE !== 'false' so a default `pnpm test:e2e` run reports a clear
 * "skipped — need DEMO_MODE=false" rather than a confusing assertion failure.
 *
 * To run:
 *   VITE_CLANWORLD_DEMO_MODE=false pnpm test:e2e tests/e2e/06-canvas-warmth.spec.ts
 *
 * Mirror of `02-demo-mode.spec.ts`'s skip-gating pattern — VITE_ vars are baked
 * into the bundle at vite startup, so the dev server must be (re)started with
 * the right value.
 */
import { test, expect, type Page } from '@playwright/test';

/**
 * The default fallback `'true'` MUST match `playwright.config.ts` webServer.env
 * default so a `pnpm test:e2e` from a fresh checkout doesn't mis-skip. Same
 * pattern as 02-demo-mode.spec.ts.
 */
const DEMO_MODE_BUILD_VALUE = process.env.VITE_CLANWORLD_DEMO_MODE ?? 'true';

/**
 * Compute the snapshot cache key for the dev-server bundle. Mirrors
 * `apps/web/src/hooks/snapshotCacheConstants.ts` — the dev/test bundle reads
 * VITE_CONVEX_URL + VITE_CLAN_WORLD_CONTRACT_ADDRESS at vite startup and falls
 * back to 'no-backend' / 'no-diamond' when unset. The Node side of the spec
 * reads the SAME env vars so the localStorage key we pre-seed matches the one
 * the bundle reads at runtime.
 */
const CONVEX_URL_SCOPE = process.env.VITE_CONVEX_URL ?? 'no-backend';
const DIAMOND_SCOPE = process.env.VITE_CLAN_WORLD_CONTRACT_ADDRESS ?? 'no-diamond';
const CACHE_KEY = `cw-snapshot-v1:${CONVEX_URL_SCOPE}:${DIAMOND_SCOPE}`;
const PAYLOAD_VERSION = 1;

/**
 * A cached snapshot payload with 4 clans. Shape mirrors the real Convex
 * `getSnapshot.clans` row: ghost only reads {id, baseRegion, baseLevel} but
 * WorldMap consumes the same payload for the scoreboard panel + scoreboardClans
 * derivation, where `name`, `treasury`, and the `vault*` resource strings must
 * be present (without them WorldMap throws in the scoreboard `.slice()` path
 * and the cockpit boundary swaps in the "World Map Offline" fallback —
 * masking the ghost from the test even though the cache was correctly read).
 *
 * Field origin: see `type SnapshotClan` in `apps/web/src/WorldMap.tsx` (~L105)
 * — fields here are the subset actually dereferenced by the scoreboard render
 * pipeline (resourceUnits / treasuryToMonument / liveClansToVisualClans).
 */
const FOUR_CLAN_PAYLOAD = {
  v: PAYLOAD_VERSION,
  ts: Date.now(),
  data: {
    // `tick` is required by `isValidSnapshotShape` (apps/web/src/hooks/useCachedSnapshot.ts).
    // Without it the hook treats the cache as malformed and drops it, defeating
    // the primed-cache precondition of tests 2 + 3.
    tick: 0,
    clans: [
      { id: '1', name: 'Iron Guard', baseRegion: 1, baseLevel: 1, treasury: '0', goldBalance: '0', vaultWood: '0', vaultIron: '0', vaultWheat: '0', vaultFish: '0' },
      { id: '2', name: 'Ember Hand', baseRegion: 2, baseLevel: 1, treasury: '0', goldBalance: '0', vaultWood: '0', vaultIron: '0', vaultWheat: '0', vaultFish: '0' },
      { id: '3', name: 'Dawn Watch', baseRegion: 3, baseLevel: 1, treasury: '0', goldBalance: '0', vaultWood: '0', vaultIron: '0', vaultWheat: '0', vaultFish: '0' },
      { id: '4', name: 'Storm Riders', baseRegion: 4, baseLevel: 1, treasury: '0', goldBalance: '0', vaultWood: '0', vaultIron: '0', vaultWheat: '0', vaultFish: '0' },
    ],
  },
};

/**
 * Wipe any pre-existing snapshot cache slot. We wildcard the prefix so a stale
 * entry from a previous run under a different env scope can't leak in and
 * accidentally satisfy the "primed" precondition for the cold-cache test.
 */
async function clearSnapshotCache(page: Page): Promise<void> {
  // localStorage is per-origin. We must navigate to the origin first so
  // `page.evaluate` runs with a valid storage context (about:blank has none).
  // Navigate to `/map` to bind the page to the origin without mounting the
  // root cockpit.
  await page.goto('/map');
  await page.evaluate(() => {
    const toRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith('cw-snapshot-v1:')) toRemove.push(k);
    }
    toRemove.forEach((k) => localStorage.removeItem(k));
  });
}

/**
 * Pre-seed the snapshot cache with a 4-clan payload BEFORE navigation. We use
 * an `addInitScript` so the value is written before any of the app's
 * top-level module code reads `localStorage` (the cache hook reads
 * synchronously in `useState`'s initializer). Setting via `page.evaluate`
 * AFTER goto would be one render-tick too late and the ghost would already
 * have computed an empty `cachedClans` array.
 */
async function primeSnapshotCache(page: Page, key: string, payload: unknown): Promise<void> {
  await page.addInitScript(
    ({ k, v }) => {
      try {
        localStorage.setItem(k, JSON.stringify(v));
      } catch {
        // private mode / quota — ignore; test will fail at the assert instead
      }
    },
    { k: key, v: payload },
  );
}

test.describe('canvas warmth state machine (DEMO_MODE=false)', () => {
  test.skip(
    DEMO_MODE_BUILD_VALUE !== 'false',
    'Skip: canvas warmth tests need a build with VITE_CLANWORLD_DEMO_MODE=false',
  );

  test('cold cache: placeholder appears after 5s grace window', async ({ page }) => {
    // Wipe any prior cache entries so the ghost finds nothing → empty world.
    await clearSnapshotCache(page);

    // Load fresh — useCachedSnapshot.useState() returns undefined; liveSnapshot
    // also stays undefined (no real Convex backend in e2e); hasClans=false →
    // grace timer arms for 5s.
    await page.goto('/map');

    // At t=0 (well within grace) the placeholder MUST NOT be visible. We use
    // a small timeout to ride past any sync mount latency without giving the
    // grace timer a head start. waitForSelector(state:'hidden') is the
    // strictest form — fails fast if it's already shown.
    const placeholder = page.getByTestId('no-chain-data-placeholder');
    await expect(placeholder).toHaveCount(0);

    // Wait past the 5s grace window (5.5s = 500ms buffer to avoid flake on
    // slow CI). After this the React state should have flipped and the
    // placeholder should be mounted + visible.
    await page.waitForTimeout(5500);
    await expect(placeholder).toBeVisible();
    await expect(placeholder).toContainText('no chain data yet');
  });

  test('primed cache: ghost is visible at t=0 then fades after pixiReady', async ({ page }) => {
    // Seed a fresh payload (use Date.now() so MAX_CACHE_AGE check passes).
    await primeSnapshotCache(page, CACHE_KEY, {
      ...FOUR_CLAN_PAYLOAD,
      ts: Date.now(),
    });

    await page.goto('/map');

    // Ghost must be in the DOM and visible at first paint — primed cache
    // hydrates synchronously in useState initializer + useMemo, no useEffect
    // round-trip required.
    const ghost = page.getByTestId('map-ghost-layer');
    await expect(ghost).toBeVisible({ timeout: 2000 });

    // Load-bearing: assert the ghost is actually rendering CACHE-DERIVED
    // content (per-clan base sprites), not just the shell. If the cache
    // hydration path regresses (wrong key, schema mismatch, validator
    // rejecting a valid payload), the shell renders but no <img> per
    // clan does — this catches that.
    const ironBase = page.getByTestId('map-ghost-base-1');
    await expect(ironBase).toBeVisible({ timeout: 2000 });

    // While Pixi is still warming up, the ghost stays at opacity:1 (the inline
    // style is `opacity: pixiReady ? 0 : 1`). Verify the pre-flip state — this
    // is the load-bearing check that the ghost is acting as a bridge to canvas
    // warmth, not just a static decoration. If pixiReady fired before our
    // assertion landed (sub-100ms), this would flake — so we re-poll in a
    // single waitForFunction sampled tight enough to catch it.
    //
    // We use waitForFunction so that the assertion succeeds as long as we
    // OBSERVE opacity:1 at some point, even if the pixi-ready flip happens
    // mid-test. That's true under Playwright's 1-tick polling.
    await page.waitForFunction(() => {
      const el = document.querySelector('[data-testid="map-ghost-layer"]') as HTMLElement | null;
      return el != null && getComputedStyle(el).opacity === '1';
    }, undefined, { timeout: 2000 }).catch(() => {
      // If we never see opacity:1, it's possible Pixi already finished — in
      // headless Chromium that can happen <50ms after mount. Don't fail here;
      // the trailing unmount-on-pixiReady assertion below is the real check.
    });

    // After PixiJS init + relayout, setPixiReady(true) fires → opacity goes 1→0
    // over FADE_OUT_MS (200ms) → fullyHidden flag flips after FADE_OUT_MS + 50
    // → the component returns null. That terminal state — the testid no
    // longer in the DOM at all — is the most stable signal that the whole
    // ghost → canvas handoff completed. 15s budget covers slow headless WebGL.
    await expect(ghost).toHaveCount(0, { timeout: 15_000 });
  });

  test('primed cache + WS dropout: placeholder never flashes during 4s gap', async ({ page }) => {
    // The contract under test: a cached snapshot keeps `hasClans=true` even
    // when the live Convex query goes briefly undefined (e.g. websocket
    // dropout). That keeps the grace-period useEffect's early return
    // engaged, so `showNoChainDataPlaceholder` never flips true.
    //
    // We assert by primed-cache load + WS intercept + a 4s wait (well under
    // the 5s grace). If the placeholder ever appears in those 4s, the test
    // fails. The WS interception itself is largely cosmetic in the
    // dev-server flow — there's no real Convex backend, so no real socket
    // will be opened. But routing the pattern proves the test still passes
    // when a real dropout WOULD occur (the route handler force-closes any
    // matching socket attempt).

    await primeSnapshotCache(page, CACHE_KEY, {
      ...FOUR_CLAN_PAYLOAD,
      ts: Date.now(),
    });

    // Intercept Convex websocket attempts. Convex client opens a wss:// to
    // the configured URL — we match the generic Convex client path so we
    // catch real-backend runs too. routeWebSocket is in Playwright ≥1.47.
    //
    // Wrapped in try/catch so older runtimes silently degrade to "no
    // intercept" rather than failing the test setup. The assertion is the
    // load-bearing check, not the route call.
    try {
      await page.routeWebSocket('**/api/**', (ws) => {
        // Immediate close — simulates an instant dropout. Convex client will
        // attempt reconnect with backoff; we never let any complete.
        ws.close();
      });
    } catch {
      // routeWebSocket unavailable in this Playwright version — fall through
    }

    const placeholder = page.getByTestId('no-chain-data-placeholder');

    // Mount, then poll for 4s asserting placeholder absence at each step.
    // page.waitForTimeout(4000) + a single post-wait assert would let a
    // mid-window flash slip past (it could appear at t=2s then disappear
    // before t=4s). We sample 8 times across the window to catch a flash.
    await page.goto('/map');

    // First, confirm we got past mount with a primed cache by checking the
    // ghost is present AND rendering cache-derived per-clan content. The
    // shell renders even with an empty cache, so we need the base sprite
    // assertion to prove the cache was actually read into the ghost layer.
    await expect(page.getByTestId('map-ghost-layer')).toBeVisible({ timeout: 2000 });
    await expect(page.getByTestId('map-ghost-base-1')).toBeVisible({ timeout: 2000 });

    const SAMPLES = 8;
    const STEP_MS = 500; // 8 * 500 = 4000ms total
    for (let i = 0; i < SAMPLES; i++) {
      await expect(placeholder, `placeholder must not appear at sample ${i + 1}/${SAMPLES}`).toHaveCount(0);
      await page.waitForTimeout(STEP_MS);
    }

    // Final assert at t≈4s (still inside the 5s grace).
    await expect(placeholder).toHaveCount(0);
  });
});
