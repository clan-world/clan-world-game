import { WorldMap } from '../WorldMap';
import { WorldMapBoundary } from './cockpit/shared/WorldMapBoundary';

/**
 * Sanctioned route-level mount for the canonical world map surface.
 * Use this for the explicit `/map` route and cockpit map cells.
 */
export function WorldMapEmbed() {
  return (
    <WorldMapBoundary>
      <WorldMap />
    </WorldMapBoundary>
  );
}
