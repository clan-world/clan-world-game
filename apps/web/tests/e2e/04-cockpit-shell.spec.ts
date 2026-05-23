import { test, expect } from '@playwright/test';

/**
 * Phase A — Cockpit layout shell.
 *
 * Verifies the structural skeleton:
 *   - / route renders the cockpit without error
 *   - 3-col 2-row grid is mounted
 *   - all 4 mini-cockpits visible
 *   - world map cell visible
 *   - default tab on each mini-cockpit is "terminal"
 *   - app-level header has tick counter + connection pill (Phase A.5b)
 *
 * Phase B follow-up tests will cover:
 *   - tab switching, tick counter live updates
 *   - real Convex data → resource values, tmux mirror
 */
test.describe('cockpit shell (Phase A)', () => {
  // Default to stubbing all 4 ttyd iframes with tiny HTML so the test never
  // depends on external network. Individual tests override the route to
  // simulate connection failures.
  test.beforeEach(async ({ page }) => {
    await page.route('**/cockpit.clan-world.com/elder-*-tty/**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: `<!DOCTYPE html><html><body data-stub="ttyd"><script>
          const match = location.pathname.match(/elder-(\\d+)-tty/);
          parent.postMessage({
            type: 'clanworld-ttyd-status',
            clanId: Number(match?.[1] ?? 0),
            status: 'open'
          }, '*');
        </script></body></html>`,
      }),
    );
  });

  test('renders 3-col 2-row layout with 4 mini-cockpits + world map', async ({
    page,
  }, testInfo) => {
    await page.goto('/');

    // No error boundary crash.
    const errorBoundary = page.locator('[data-testid="error-boundary"]');
    await expect(errorBoundary).toHaveCount(0);

    // Grid root mounts.
    await expect(page.locator('[data-testid="cockpit-root"]')).toBeVisible();
    await expect(page.locator('[data-testid="cockpit-grid"]')).toBeVisible();

    // All 4 corner mini-cockpits visible.
    for (const clanId of [1, 2, 3, 4]) {
      await expect(
        page.locator(`[data-testid="mini-cockpit-${clanId}"]`),
      ).toBeVisible();
    }

    // Center world-map cell visible (the pixi canvas mounts inside it
    // asynchronously, so we just assert the cell is in the DOM).
    await expect(page.locator('[data-testid="cockpit-worldmap"]')).toBeVisible();

    // Only Elder 1 opens ttyd on page mount; the other panels start on a
    // lightweight tab so the cockpit does not create 4 terminal connections.
    const terminalClanId = 1;
    await expect(
      page.locator(`[data-testid="mini-cockpit-${terminalClanId}-tab-terminal"]`),
    ).toHaveAttribute('data-active', 'true');
    await expect(
      page.locator(`[data-testid="mini-cockpit-${terminalClanId}-content-terminal"]`),
    ).toBeVisible();

    for (const clanId of [2, 3, 4]) {
      const terminalTab = page.locator(
        `[data-testid="mini-cockpit-${clanId}-tab-terminal"]`,
      );
      await expect(terminalTab).toHaveAttribute('data-active', 'false');
      await expect(
        page.locator(`[data-testid="mini-cockpit-${clanId}-content-vault"]`),
      ).toBeVisible();
    }

    const vault = page.locator('[data-testid="mini-cockpit-2-content-vault"]');
    for (const label of ['Gold', 'Wood', 'Iron', 'Wheat', 'Fish', 'Blueprint']) {
      await expect(vault.getByText(label, { exact: true })).toBeVisible();
    }
    await expect(vault.getByText('Ore', { exact: true })).toHaveCount(0);
    await expect(vault.getByText('Stone', { exact: true })).toHaveCount(0);

    // Phase A.5b: tick counter is now app-level (single instance), not
    // per-mini-cockpit. The connection pill is also rendered once.
    await expect(page.locator('[data-testid="cockpit-header-tick"]')).toBeVisible();
    await expect(page.locator('[data-testid="cockpit-header-tick"]')).toHaveCount(1);
    await expect(
      page.locator('[data-testid="cockpit-connection-pill"]'),
    ).toBeVisible();

    // Visual debug aid.
    await page.screenshot({
      path: testInfo.outputPath('04-cockpit-shell.png'),
      fullPage: true,
    });
  });

  test('connection pill auto-recovers after heartbeat failures', async ({
    page,
  }) => {
    let shouldFail = true;
    await page.route('**/cockpit.clan-world.com/elder-*-tty/**', (route) => {
      if (shouldFail) {
        return route.abort('failed');
      }
      return route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: '<!DOCTYPE html><html><body data-stub="ttyd-recovered"></body></html>',
      });
    });

    await page.goto('/');

    const pill = page.locator('[data-testid="cockpit-connection-pill"]');
    await expect(pill).toBeVisible();

    // Wait for the pill to transition to disconnected. The state machine
    // must traverse `reconnecting` first, but we just assert the terminal
    // state to keep the test deterministic.
    await expect(pill).toHaveAttribute('data-status', 'disconnected', {
      timeout: 30_000,
    });

    // Manual reconnect button is rendered in the disconnected state.
    const retryBtn = page.locator('[data-testid="cockpit-connection-pill-retry"]');
    await expect(retryBtn).toBeVisible();

    shouldFail = false;
    await expect(pill).toHaveAttribute('data-status', 'connected', {
      timeout: 20_000,
    });
  });

  test('terminal iframe reloads when ttyd reports a closed websocket', async ({
    page,
  }) => {
    let documentLoads = 0;
    await page.route('**/cockpit.clan-world.com/elder-1-tty/**', (route) => {
      if (route.request().resourceType() !== 'document') {
        return route.fulfill({ status: 200, body: '' });
      }

      documentLoads += 1;
      const shouldClose = documentLoads === 1;
      return route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: `<!DOCTYPE html><html><body><script>
          parent.postMessage({
            type: 'clanworld-ttyd-status',
            clanId: 1,
            status: 'open'
          }, '*');
          ${shouldClose ? `
            setTimeout(() => parent.postMessage({
              type: 'clanworld-ttyd-status',
              clanId: 1,
              status: 'close'
            }, '*'), 50);
          ` : ''}
        </script></body></html>`,
      });
    });

    await page.goto('/');

    await expect
      .poll(() => documentLoads, { timeout: 8_000 })
      .toBeGreaterThanOrEqual(2);

    await expect(
      page.locator('[data-testid="mini-cockpit-1-content-terminal"]'),
    ).toHaveAttribute('data-terminal-status', 'connected');
  });

  test('terminal iframe stays connected when ttyd loads without the reconnect shim', async ({
    page,
  }) => {
    let documentLoads = 0;
    await page.route('**/cockpit.clan-world.com/elder-1-tty/**', (route) => {
      if (route.request().resourceType() !== 'document') {
        return route.fulfill({ status: 200, body: '' });
      }

      documentLoads += 1;
      return route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: '<!DOCTYPE html><html><body data-stub="ttyd-blank"></body></html>',
      });
    });

    await page.goto('/');

    await expect(
      page.locator('[data-testid="mini-cockpit-1-content-terminal"]'),
    ).toHaveAttribute('data-terminal-status', 'connected');

    await page.waitForTimeout(6_000);
    expect(documentLoads).toBe(1);
  });
});
