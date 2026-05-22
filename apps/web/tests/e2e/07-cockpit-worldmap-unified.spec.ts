import { test, expect, type Page } from '@playwright/test';

async function stubTerminalIframes(page: Page): Promise<void> {
  await page.route('**/cockpit.clan-world.com/elder-*-tty/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: '<!DOCTYPE html><html><body data-stub="ttyd"></body></html>',
    }),
  );
}

test.describe('unified world map routes', () => {
  test.beforeEach(async ({ page }) => {
    await stubTerminalIframes(page);
  });

  test('/map and root cockpit expose the same version badge text', async ({ page }) => {
    await page.goto('/map');
    const mapBadge = page.getByTestId('version-badge');
    await expect(mapBadge).toBeVisible();
    await expect(page.locator('canvas')).toHaveCount(1, { timeout: 15_000 });
    const mapVersion = (await mapBadge.textContent())?.trim();
    expect(mapVersion).toBeTruthy();

    await page.goto('/');
    const cockpitBadge = page.getByTestId('version-badge');
    await expect(cockpitBadge).toBeVisible();
    await expect(page.locator('canvas')).toHaveCount(1, { timeout: 15_000 });
    await expect(cockpitBadge).toHaveText(mapVersion ?? '');
  });

  test('desktop cockpit mounts one canonical world map', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name.includes('mobile'), 'desktop-only cockpit layout check');

    await page.goto('/');

    const mapCell = page.getByTestId('cockpit-worldmap');
    await expect(page.getByTestId('cockpit-root')).toBeVisible();
    await expect(page.getByTestId('cockpit-grid')).toBeVisible();
    await expect(mapCell).toBeVisible();
    await expect(mapCell.locator('canvas')).toHaveCount(1, { timeout: 15_000 });
    await expect(page.getByTestId('version-badge')).toBeVisible();
    expect(await page.getByTestId('map-ghost-layer').count()).toBeLessThanOrEqual(1);
  });

  test('mobile cockpit keeps one map canvas through collapse', async ({ page }, testInfo) => {
    test.skip(!testInfo.project.name.includes('mobile'), 'mobile-only cockpit layout check');

    await page.goto('/');

    const layout = page.getByTestId('cockpit-mobile-layout');
    const mapRegion = page.getByTestId('cockpit-mobile-worldmap-region');
    const toggle = page.getByTestId('cockpit-mobile-collapse-toggle');

    await expect(layout).toBeVisible();
    await expect(mapRegion).toBeVisible();
    await expect(mapRegion.locator('canvas')).toHaveCount(1, { timeout: 15_000 });
    await expect(page.getByTestId('version-badge')).toBeVisible();

    const before = await layout.getAttribute('data-collapsed');
    await toggle.click();
    await expect(layout).not.toHaveAttribute('data-collapsed', before ?? '');
    await expect(mapRegion.locator('canvas')).toHaveCount(1);
  });

  test('legacy /cockpit redirects to root cockpit', async ({ page }) => {
    await page.goto('/cockpit');
    await expect.poll(() => new URL(page.url()).pathname, { timeout: 5_000 }).toBe('/');
    await expect(page.getByTestId('cockpit-root')).toBeVisible();
  });
});
