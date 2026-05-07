import { ConvexReactClient } from 'convex/react';

/**
 * Convex client. Reuses the existing apps/server deployment — there is one
 * Convex project across web, mobile, and any future surface, per the slice 0
 * decision in artifacts/implementation/slice-0-mobile-spectator.md.
 *
 * EXPO_PUBLIC_CONVEX_URL must match the cockpit's VITE_CONVEX_URL value at
 * runtime; both point at the same deployment. ONE env var per concept
 * (hackathon rule §4) — they have different prefixes only because each
 * bundler enforces a different visibility prefix.
 */

const url = process.env.EXPO_PUBLIC_CONVEX_URL;

if (!url) {
  // Fail loudly during dev so misconfigured installs are obvious. The
  // alternative — a silent stub — masked Convex outages in the cockpit
  // before; we don't repeat that mistake here.
  throw new Error(
    'EXPO_PUBLIC_CONVEX_URL is not set. Add it to apps/mobile/.env.local ' +
      '(it should match the cockpit\'s VITE_CONVEX_URL).',
  );
}

export const convex = new ConvexReactClient(url, {
  // RN has no "leave page" concept — there's nothing to warn about.
  unsavedChangesWarning: false,
});
