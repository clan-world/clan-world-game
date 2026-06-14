import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { execSync } from 'node:child_process';

// Canonical port resolved from port-for registry. Falls back to FALLBACK_PORT
// when port-for is unavailable (CI, non-do-box hosts). PORT env override wins.
const FALLBACK_PORT = 58440;
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

export default defineConfig({
  plugins: [react()],
  // Served as a subpath of the main ClanWorld Walrus Site at /mint/ — absolute
  // base so SPA deep-links resolve assets correctly at any depth under /mint/.
  base: '/mint/',
  server: {
    port: DEFAULT_PORT,
    host: '127.0.0.1',
  },
});
