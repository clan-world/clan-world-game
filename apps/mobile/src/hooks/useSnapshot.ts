import { useQuery } from 'convex/react';
// Convex codegen lives in apps/server. Relative-path import is what monorepo
// Convex setups normally do — extracting types into packages/shared is
// deferred per slice 0 §9 (only do it when a slice forces the split).
// Metro resolves this thanks to monorepo-aware watchFolders in metro.config.js.
import { api } from '../../../server/convex/_generated/api';

/**
 * Live world snapshot — current tick, season, regions, clans, last update.
 * Updates reactively over websocket; no polling. Returns undefined while the
 * first round-trip is in flight (typical Convex `useQuery` semantics).
 */
export function useSnapshot() {
  return useQuery(api.getSnapshot.getSnapshot);
}

/**
 * Recent on-chain events — used for Hearth's "last event" line. Convex
 * caps the result; we just take the head row.
 */
export function useRecentChainEvents() {
  return useQuery(api.events.getRecentChainEvents);
}

/**
 * iNFT demo state for one clan. Hall renders four of these in parallel
 * (clanIds 1-4). Returns { token, transfers, memory, bulletins }.
 */
export function useInftDemoState(clanId: number) {
  return useQuery(api.inft.getInftDemoState, { clanId });
}
