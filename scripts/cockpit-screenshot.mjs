#!/usr/bin/env node
// Playwright cockpit screenshot tool.
// Opens https://app.clan-world.com (or $URL), waits for the cockpit + TTYDs
// to settle, takes a desktop-layout full-page screenshot (all 4 elders
// visible) plus 4 close-up screenshots of each elder's terminal panel.
//
// Usage:
//   node scripts/cockpit-screenshot.mjs              # default app URL
//   URL=https://other.host node scripts/cockpit-screenshot.mjs
//   OUTDIR=/tmp/foo node scripts/cockpit-screenshot.mjs
//
// Outputs to $OUTDIR (default /tmp/cw-cockpit) — overwrites prior files.

import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const URL = process.env.URL ?? 'https://app.clan-world.com';
const OUTDIR = process.env.OUTDIR ?? '/tmp/cw-cockpit';
const HEADLESS = process.env.HEADLESS !== 'false';

console.log(`[cockpit-screenshot] URL=${URL} OUTDIR=${OUTDIR}`);

await mkdir(OUTDIR, { recursive: true });

const browser = await chromium.launch({ headless: HEADLESS });
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  // Convince the page we are a real Chrome user, not a bot.
  userAgent:
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36',
  ignoreHTTPSErrors: true,
});

const page = await context.newPage();

const consoleErrors = [];
page.on('console', (msg) => {
  if (msg.type() === 'error') consoleErrors.push(msg.text());
});
page.on('pageerror', (err) => consoleErrors.push(`pageerror: ${err.message}`));

const failedRequests = [];
page.on('requestfailed', (req) => {
  failedRequests.push(`${req.method()} ${req.url()} — ${req.failure()?.errorText ?? 'unknown'}`);
});

console.log('[cockpit-screenshot] navigating…');
await page.goto(URL, { waitUntil: 'networkidle', timeout: 30000 });

// Cockpit takes a moment to mount + ttyd iframes to attempt connect.
await page.waitForTimeout(8000);

const fullPath = `${OUTDIR}/cockpit-full.png`;
await page.screenshot({ path: fullPath, fullPage: true });
console.log(`[cockpit-screenshot] full-page: ${fullPath}`);

// Per-elder close-ups. Desktop layout puts 4 mini-cockpits at grid corners.
// Each mini-cockpit has TERM/VAULT/CLAN/OG/COMMS/ADMIN tabs — only the
// TERM tab renders the live ttyd iframe. Click TERM in each mini before
// taking the screenshot, then wait for the ttyd ws upgrade to settle.
const miniSelectors = [
  '[data-testid="mini-cockpit-1"]',
  '[data-testid="mini-cockpit-2"]',
  '[data-testid="mini-cockpit-3"]',
  '[data-testid="mini-cockpit-4"]',
];
for (let i = 0; i < miniSelectors.length; i++) {
  const sel = miniSelectors[i];
  const elder = i + 1;
  try {
    const mini = page.locator(sel).first();
    if ((await mini.count()) === 0) {
      console.log(`[cockpit-screenshot] elder-${elder}: ${sel} not found — skipped`);
      continue;
    }
    // Click the TERM tab within THIS mini-cockpit. Try a few selectors.
    const termTab = mini
      .locator('button:has-text("TERM"), [role="tab"]:has-text("TERM"), [data-tab="term"]')
      .first();
    if ((await termTab.count()) > 0) {
      await termTab.click({ force: true }).catch(() => {});
      // ttyd handshake + render needs a beat.
      await page.waitForTimeout(2500);
    }
    const out = `${OUTDIR}/elder-${elder}.png`;
    await mini.screenshot({ path: out });
    console.log(`[cockpit-screenshot] elder-${elder}: ${out}`);
  } catch (e) {
    console.log(`[cockpit-screenshot] elder-${elder}: error — ${e.message}`);
  }
}

// Re-take the full-page screenshot after all TERM tabs have been clicked.
const fullPath2 = `${OUTDIR}/cockpit-full-all-terms.png`;
await page.screenshot({ path: fullPath2, fullPage: true });
console.log(`[cockpit-screenshot] full-page (all TERMs active): ${fullPath2}`);

// Best-effort iframe inspection: each elder's terminal renders a ttyd iframe.
// If the iframe URL is dead, ttyd never loads — surface URL + error.
const iframes = page.frames();
console.log(`[cockpit-screenshot] iframes detected: ${iframes.length}`);
for (const f of iframes) {
  if (f === page.mainFrame()) continue;
  console.log(`  - iframe url=${f.url()}`);
}

if (consoleErrors.length) {
  console.log(`[cockpit-screenshot] console errors (${consoleErrors.length}):`);
  consoleErrors.slice(0, 10).forEach((e) => console.log(`  - ${e}`));
}
if (failedRequests.length) {
  console.log(`[cockpit-screenshot] failed requests (${failedRequests.length}):`);
  failedRequests.slice(0, 10).forEach((e) => console.log(`  - ${e}`));
}

await browser.close();
console.log('[cockpit-screenshot] done');
