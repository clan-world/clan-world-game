import { defineConfig } from 'vitest/config';

// Scope vitest strictly to unit tests next to source — the Playwright e2e
// specs under tests/e2e/ share the @playwright/test runtime and explode if
// vitest tries to collect them (no Playwright fixtures, no test.describe ctx).
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    exclude: ['tests/**', 'node_modules/**', 'dist/**'],
    environment: 'node',
  },
});
