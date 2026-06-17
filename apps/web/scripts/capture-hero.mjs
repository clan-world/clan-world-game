// Authored gameplay hero-video capture for the ClanWorld landing page.
//
// Drives the full-screen world map (/map?capture=1) with a scripted cinematic
// camera, records it via Playwright's native video recorder, then shells out to
// ffmpeg to trim the load-in and produce web-ready hero.{webm,mp4} + poster
// into the landing's public/hero/ dir.
//
// Prereq: a DEMO_MODE dev/preview server must be running. Point BASE at it:
//   VITE_CLANWORLD_DEMO_MODE=true PORT=58748 pnpm dev
//
// Usage:
//   node scripts/capture-hero.mjs
//   BASE=http://127.0.0.1:58748 node scripts/capture-hero.mjs
//   node scripts/capture-hero.mjs --no-encode      # keep raw webm only
//
import { chromium } from '@playwright/test';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = path.resolve(__dirname, '..');
const LANDING_HERO = path.resolve(WEB_ROOT, '../landing/public/hero');
const RAW_DIR = path.resolve(WEB_ROOT, '.capture-frames');
const BASE = process.env.BASE || 'http://127.0.0.1:58748';
const W = 1280, H = 720;
const ENCODE = !process.argv.includes('--no-encode');
const FFMPEG = process.env.FFMPEG || '/usr/bin/ffmpeg';
const GL_ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];

// Cinematic camera keyframes. position = world point to center on (world is
// 1086x1448, center ~543,724); scale absolute. Opens + closes on the same wide
// establishing frame for a seamless loop.
const CAMERA = [
  { hold: 2400 },                                                    // establish (initial fit)
  { x: 543, y: 300, scale: 2.6, time: 3400, ease: 'easeInOutSine' }, // push to the monument
  { x: 560, y: 820, scale: 2.6, time: 3800, ease: 'easeInOutSine' }, // glide down across the clans
  { x: 815, y: 800, scale: 3.1, time: 2800, ease: 'easeInOutSine' }, // settle on a clan hold
  { x: 300, y: 560, scale: 3.0, time: 3000, ease: 'easeInOutSine' }, // sweep to the far village
  { fit: true, time: 3600, ease: 'easeInOutQuad', hold: 2000 },      // pull back to establish (loop seam)
];

function sh(cmd, args) {
  process.stdout.write(`$ ${cmd} ${args.slice(0, 6).join(' ')} …\n`);
  execFileSync(cmd, args, { stdio: ['ignore', 'ignore', 'inherit'] });
}
const mb = (f) => (Number(execFileSync('stat', ['-c', '%s', f], { encoding: 'utf8' }).trim()) / 1048576).toFixed(2);

async function main() {
  rmSync(RAW_DIR, { recursive: true, force: true });
  mkdirSync(RAW_DIR, { recursive: true });
  mkdirSync(LANDING_HERO, { recursive: true });

  let lead = 0;
  let camDur = 0;
  let browser;
  try {
    browser = await chromium.launch({ args: GL_ARGS });
    const context = await browser.newContext({
      viewport: { width: W, height: H },
      deviceScaleFactor: 1,
      recordVideo: { dir: RAW_DIR, size: { width: W, height: H } },
    });
    const recStart = Date.now();               // ≈ when the video recording begins
    const page = await context.newPage();
    page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 200)));

    console.log('navigating…');
    await page.goto(`${BASE}/map?capture=1`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!(window.__cwCapture && window.__cwCapture.ready), null, { timeout: 25000 });
    await page.waitForTimeout(700);            // brief settle so first sprites paint before the camera rolls

    const camStart = Date.now();
    lead = Math.max(0, (camStart - recStart) / 1000 - 0.4); // trim the load-in, keep ~0.4s pre-roll
    console.log('rolling camera (load-in lead =', lead.toFixed(2), 's)…');
    await page.evaluate(async (keyframes) => {
      const cap = window.__cwCapture;
      if (!cap || !cap.viewport) return;       // HMR/navigation could clear the hook between calls
      const vp = cap.viewport;
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      const fitScale = cap.fitScale;
      const cx = cap.world.width / 2;
      for (const k of keyframes) {
        if (k.x !== undefined || k.fit) {
          vp.plugins.remove('animate');
          vp.animate({
            position: k.fit ? { x: cx, y: cap.world.height * 0.42 } : { x: k.x, y: k.y },
            scale: k.fit ? fitScale : k.scale,
            time: k.time,
            ease: k.ease || 'easeInOutSine',
          });
          await wait(k.time + 60);
        }
        if (k.hold) await wait(k.hold);
      }
    }, CAMERA);
    camDur = (Date.now() - camStart) / 1000;

    await page.close();            // flush the video
    await context.close();
  } finally {
    if (browser) await browser.close().catch(() => {});
  }

  const raw = readdirSync(RAW_DIR).find((f) => f.endsWith('.webm'));
  if (!raw) throw new Error('no video produced');
  const rawPath = path.join(RAW_DIR, raw);
  console.log('raw video:', rawPath, `(${mb(rawPath)} MB)`);

  if (!ENCODE) { console.log('--no-encode: done'); process.exit(0); }
  if (!existsSync(FFMPEG)) throw new Error(`ffmpeg not found at ${FFMPEG}`);

  const mp4 = path.join(LANDING_HERO, 'hero.mp4');
  const webm = path.join(LANDING_HERO, 'hero.webm');
  const poster = path.join(LANDING_HERO, 'hero-poster.jpg');

  // Trim the load-in by CONTENT, not wall-clock: Playwright's video timeline
  // doesn't align 1:1 with Date.now(), so detect where the leading black ends
  // (the map's first paint) and trim there. Falls back to the measured `lead`.
  const probe = spawnSync(FFMPEG, ['-i', rawPath, '-vf', 'blackdetect=d=0.1:pix_th=0.10', '-an', '-f', 'null', '-'], { encoding: 'utf8' });
  const bd = (probe.stderr || '').match(/black_start:0(?:\.0+)?\s+black_end:([\d.]+)/);
  const rawDur = Number(spawnSync('/usr/bin/ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', rawPath], { encoding: 'utf8' }).stdout.trim()) || 0;
  const ss = (bd ? Math.max(0, parseFloat(bd[1]) - 0.05) : Math.max(0, lead)).toFixed(2);
  // Run to the end of the captured camera, bounded so a long pre-camera settle
  // or trailing frames can't bloat the clip. (~0.7s settle + camera arc.)
  const dur = Math.max(1, Math.min(rawDur - parseFloat(ss) - 0.05, camDur + 1.2)).toFixed(2);

  // -ss before -i (fast seek) then encode. MP4 = H.264 (Safari/iOS muted-autoplay),
  // WebM = VP9 (smaller). Audio stripped so autoplay is honored everywhere.
  sh(FFMPEG, ['-y', '-ss', ss, '-i', rawPath, '-t', dur, '-an', '-r', '30',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-crf', '23', '-movflags', '+faststart', mp4]);
  sh(FFMPEG, ['-y', '-ss', ss, '-i', rawPath, '-t', dur, '-an', '-r', '30',
    '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuv420p', '-b:v', '0', '-crf', '36', webm]);
  // Poster — a mid-action zoomed still (~6s into the trimmed clip).
  sh(FFMPEG, ['-y', '-ss', '6', '-i', mp4, '-frames:v', '1', '-update', '1', '-q:v', '3', poster]);

  console.log('\nwrote (blackdetect trim ss=%s dur=%s, camDur=%s):', ss, dur, camDur.toFixed(1));
  for (const f of [webm, mp4, poster]) console.log(`  ${path.basename(f)}  (${mb(f)} MB)`);
  process.exit(0);
}

main().catch((e) => { console.error('CAPTURE FAILED:', e); process.exit(1); });
