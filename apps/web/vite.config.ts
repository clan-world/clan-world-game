import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { adminApiPlugin } from './server/admin/middleware';

// Canonical port resolved from port-for registry (clan-world slot 587, env=dev).
// Falls back to FALLBACK_PORT (canonical value from .world/ports.yml) when port-for is
// unavailable (CI, non-do-box hosts). PORT env override takes precedence.
const FALLBACK_PORT = 58740;
const DEFAULT_PORT = (() => {
  if (process.env.PORT) {
    const p = parseInt(process.env.PORT, 10);
    return Number.isNaN(p) ? FALLBACK_PORT : p;
  }
  try {
    const port = parseInt(execSync('port-for clan-world-frontend-dev', { encoding: 'utf8' }).trim(), 10);
    return Number.isNaN(port) ? FALLBACK_PORT : port;
  } catch {
    return FALLBACK_PORT;
  }
})();

/**
 * Inject `<link rel="preload" as="image">` for the map-BG asset into index.html.
 *
 * Why: MapGhostLayer.tsx renders the world-map.png background ASAP and ideally
 * with `decoding="async"` so the first React paint doesn't block on bitmap
 * decode. For that to be safe on cold cache (no HTTP entry), the browser needs
 * to start fetching+decoding the PNG as early as possible. A `<link rel=preload>`
 * in the HTML head gives the browser the URL during HTML parse — before any
 * JS executes — so the fetch races with React bootstrap instead of waiting for
 * mount. See issues #271, #298.
 *
 * Vite hashes the asset at build time (`world-map.<hash>.png`), so the link
 * href can't be static. We compute the right href for both modes:
 *   - In build: `ctx.bundle` is populated → find the emitted asset by its
 *     ORIGINAL name (`output.name === 'world-map.png'`) rather than regex over
 *     the hashed key. This is hash-shape independent (a Vite hash containing
 *     hyphens won't break the lookup, per gemini-flash review on PR #303) and
 *     cleanly excludes sibling assets like `world-map-winter.png` without
 *     needing a fragile character-class.
 *   - In dev: `ctx.bundle` is undefined → use the source path so the dev
 *     server's middleware resolves it via the import graph.
 *
 * We return Vite tag descriptors (`{ tag, attrs, injectTo: 'head' }`) rather
 * than doing a string `replace` on `</head>`. The descriptor path is what
 * Vite's own preload helper uses, so injection is insensitive to surrounding
 * whitespace, case (`</HEAD>`), or other transforms reshaping the HTML —
 * closing the "string-replace fragility" LOW from codex review on PR #303.
 *
 * `order: 'pre'` keeps the tag toward the top of `<head>`, before other
 * Vite-injected script/style links.
 */
function mapBgPreloadPlugin(): Plugin {
  return {
    name: 'inject-map-bg-preload',
    transformIndexHtml: {
      order: 'pre',
      handler(html, ctx) {
        // Honor a custom `base` if/when one is configured (e.g. deploying
        // under a subpath). Defaults to '/' which is the current setup.
        const base = ctx.server?.config.base ?? '/';
        let href: string | null = null;
        if (ctx.bundle) {
          // Build: locate by original source filename. Vite/Rollup populates
          // `output.name` with the pre-hash basename for asset outputs, so
          // this is hash-shape independent. Restrict to type==='asset' so we
          // don't accidentally match a chunk that happens to be named the same.
          for (const [key, output] of Object.entries(ctx.bundle)) {
            if (output.type === 'asset' && output.name === 'world-map.png') {
              href = `${base}${key}`.replace(/\/{2,}/g, '/');
              break;
            }
          }
        } else {
          // Dev: Vite serves the source asset directly via /src/assets/...
          href = `${base}src/assets/world-map.png`.replace(/\/{2,}/g, '/');
        }
        if (!href) return html;
        return {
          html,
          tags: [
            {
              tag: 'link',
              attrs: { rel: 'preload', as: 'image', href },
              injectTo: 'head',
            },
          ],
        };
      },
    },
  };
}

// VITE_APP_VERSION: stamped at build time from the GitHub release tag (set by
// `.github/workflows/deploy-prod.yml` to `${{ github.ref_name }}`). The
// VersionBadge overlay displays this so deployed builds are visibly tagged
// and stale-deploy regressions are obvious during UAT. Locally we fall back
// to 'dev' so the badge is never empty. See issue #312.
const APP_VERSION = process.env.VITE_APP_VERSION ?? 'dev';

// envDir: load .env.local from the monorepo root, not the web app folder.
// .env.local lives at <repo-root>/.env.local and is shared with server/agents.
// Without this, VITE_* values are undefined at build time and the prod bundle
// has no Convex URL or demo-mode configuration baked in.
export default defineConfig({
  plugins: [react(), mapBgPreloadPlugin(), adminApiPlugin()],
  envDir: path.resolve(__dirname, '../..'),
  define: {
    'import.meta.env.VITE_APP_VERSION': JSON.stringify(APP_VERSION),
  },
  server: {
    port: DEFAULT_PORT,
    host: '127.0.0.1',
  },
});
