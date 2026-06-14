import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Agent Control Page — visual deliverable.
 *
 * Captures three Playwright screenshots at the iPhone 14 portrait viewport
 * (390×844) covering the three demo states:
 *
 *   1. screenshot-1-not-logged-in.png — initial gated CTA.
 *   2. screenshot-2-logged-in-idle.png — after connect + decrypt, inputs
 *      hydrated with mock essence, cooldown=0.
 *   3. screenshot-3-cooldown-active.png — mid-cooldown (4 min left), cost
 *      preview shows "5 + 5000 ➡ Treasury", message counter = 1.
 *
 * Saves to apps/web/docs/screenshots/agent-control-*.png so they're
 * tracked in git as the design deliverable.
 */

// __dirname shim (vite/playwright run as ESM)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// docs/screenshots is at apps/web/docs/screenshots — two levels up from
// apps/web/tests/e2e/ to reach apps/web/.
const SHOTS_DIR = path.resolve(__dirname, '../../docs/screenshots');

const VIEWPORT = { width: 390, height: 844 };

test.use({ viewport: VIEWPORT });

test.describe('agent control page — visual deliverable', () => {
  test('1 — gated state (not logged in)', async ({ page }) => {
    await page.goto('/agents/1');
    // Wait for the connect gate to mount + animate in.
    await expect(page.locator('[data-testid="connect-gate"]')).toBeVisible();
    await expect(page.locator('[data-testid="connect-wallet-btn"]')).toBeVisible();
    // Let the lockstone settle.
    await page.waitForTimeout(700);
    await page.screenshot({
      path: path.join(SHOTS_DIR, 'agent-control-1-not-logged-in.png'),
      fullPage: false,
    });
  });

  test('2 — logged in, idle, essence hydrated', async ({ page }) => {
    await page.goto('/agents/1?fast=1');
    await page.locator('[data-testid="connect-wallet-btn"]').click();
    // After fast-mode: 200ms seal + 400ms decrypt. Wait for the live UI.
    await expect(page.locator('[data-testid="essence-section"]')).toBeVisible({
      timeout: 5000,
    });
    await expect(page.locator('[data-testid="strategy-input"]')).toBeVisible();
    // Wait for textarea to be hydrated with mock content.
    await expect(page.locator('[data-testid="strategy-input"]')).not.toHaveValue('');
    // Let any toasts dismiss + animations settle.
    await page.waitForTimeout(2600);
    await page.screenshot({
      path: path.join(SHOTS_DIR, 'agent-control-2-logged-in-idle.png'),
      fullPage: false,
    });
  });

  test('3 — cooldown active mid-burn', async ({ page }) => {
    await page.goto('/agents/1?fast=1&test=1');
    await page.locator('[data-testid="connect-wallet-btn"]').click();
    await expect(page.locator('[data-testid="whispers-section"]')).toBeVisible({
      timeout: 5000,
    });
    // Wait long enough for the welcome-toast to dismiss (TTL 2400ms).
    await page.waitForTimeout(2700);

    // Force a sent state mid-cooldown.
    // Spec target: cost preview shows "5 + 5000 GOLD ➡️ Treasury", which
    // requires Math.ceil(remainingMs / 60000) = 5. We pick 4m30s remaining
    // (Math.ceil(4.5) = 5 → 5000 skip-tax), so time-since-last = 5m30s ago.
    await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const hook = (window as any).__agentTestHook;
      if (!hook) throw new Error('test hook missing');
      // 5m30s elapsed of a 10-min cooldown → 4m30s remaining → ceil = 5 → 5000.
      hook.setCooldownAgo(5 * 60 + 30, 1);
    });

    // Type something so the send button isn't empty-disabled.
    await page.locator('[data-testid="whisper-input"]').fill(
      'Forest patrol confirmed — bandits at NW perimeter. Hold ore. Trade with Iron Guard at 3:1 if Crimson signals truce.',
    );

    // Wait for the cooldown bar to update + cost preview to recompute.
    await page.waitForTimeout(600);
    await expect(page.locator('[data-testid="cost-skip-tax"]')).toBeVisible();
    // Verify the cost preview reads 5000 (5 min × 1000) — sanity gate.
    await expect(page.locator('[data-testid="cost-skip-tax"]')).toHaveText('5,000');

    await page.screenshot({
      path: path.join(SHOTS_DIR, 'agent-control-3-cooldown-active.png'),
      fullPage: false,
    });
  });
});
