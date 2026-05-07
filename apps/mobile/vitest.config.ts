import { defineConfig } from 'vitest/config';
import path from 'node:path';

// Slice 0 only runs unit tests for pure logic modules (mwa typed-error
// mapping, secure-store key derivation, webview-bridge injection script
// builder, device detection). RN-context-dependent code is verified at
// runtime on a device. No jsdom/happy-dom needed for this scope.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    environment: 'node',
    globals: false,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
