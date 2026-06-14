// One-off screenshot of the cockpit Agent (0g) tab for PR3 review.
// Renders against the dev server (stub-fallback data — no live Convex needed).
// Usage: BASE=http://127.0.0.1:58743 node scripts/shot-agent-tab.mjs /tmp/pr3-agent-tab.png
import { chromium } from '@playwright/test';

const BASE = process.env.BASE || 'http://127.0.0.1:58743';
const OUT = process.argv[2] || '/tmp/pr3-agent-tab.png';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1100 }, deviceScaleFactor: 2 });
page.on('console', (m) => { if (m.type() === 'error') console.log('[console.error]', m.text()); });

await page.goto(BASE, { waitUntil: 'networkidle' });

// Open the Agent (0g) tab on every mini-cockpit so all four panels show it.
const tabs = page.locator('[data-testid$="-tab-0g"]');
const n = await tabs.count();
console.log('agent tabs found:', n);
for (let i = 0; i < n; i++) await tabs.nth(i).click();

// Wait for at least one Walrus KV section to mount.
await page.locator('[data-testid$="-0g-kv"]').first().waitFor({ timeout: 10_000 });
await page.waitForTimeout(400);

await page.screenshot({ path: OUT, fullPage: true });
console.log('saved', OUT);

// Also capture a tight shot of clan-1's Agent panel for a focused review image.
const panel = page.locator('[data-testid="mini-cockpit-1-content-0g"]').first();
if (await panel.count()) {
  await panel.screenshot({ path: OUT.replace(/\.png$/, '-panel.png') });
  console.log('saved panel', OUT.replace(/\.png$/, '-panel.png'));
}

await browser.close();
