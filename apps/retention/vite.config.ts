import { execSync } from 'node:child_process';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const FALLBACK_PORT = 58742;
const FALLBACK_API_PORT = 38742;
const IS_BUILD = process.env.npm_lifecycle_event === 'build';

const DEFAULT_PORT = (() => {
  if (IS_BUILD) return FALLBACK_PORT;

  if (process.env.PORT) {
    const parsed = parseInt(process.env.PORT, 10);
    return Number.isNaN(parsed) ? FALLBACK_PORT : parsed;
  }

  try {
    const port = parseInt(execSync('port-for clan-world-retention-dev', { encoding: 'utf8' }).trim(), 10);
    return Number.isNaN(port) ? FALLBACK_PORT : port;
  } catch {
    return FALLBACK_PORT;
  }
})();

const API_PORT = (() => {
  if (IS_BUILD) return FALLBACK_API_PORT;

  if (process.env.RETENTION_API_PORT) {
    const parsed = parseInt(process.env.RETENTION_API_PORT, 10);
    return Number.isNaN(parsed) ? FALLBACK_API_PORT : parsed;
  }

  try {
    const port = parseInt(execSync('port-for clan-world-retention-api-dev', { encoding: 'utf8' }).trim(), 10);
    return Number.isNaN(port) ? FALLBACK_API_PORT : port;
  } catch {
    return FALLBACK_API_PORT;
  }
})();

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: DEFAULT_PORT,
    allowedHosts: ['gold.clan-world.com'],
    proxy: {
      '/api': `http://127.0.0.1:${API_PORT}`,
    },
  },
});
