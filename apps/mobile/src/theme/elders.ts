/**
 * Mirror of the ELDERS roster from `apps/web/src/styles/cockpit-tokens.ts`.
 * Keep in sync — clanIds, names, archetypes, glyphs, and accents must match
 * the cockpit verbatim or the WebView and the mobile shell will disagree on
 * which clan is which.
 */

export interface ElderDef {
  readonly clanId: number;
  readonly name: string;
  readonly archetype: string;
  readonly glyph: string;
  readonly accent: string;
}

export const ELDERS: ReadonlyArray<ElderDef> = [
  { clanId: 1, name: 'Storm Riders', archetype: 'Aggressive Raider', glyph: '⚡', accent: '#5a8aa8' },
  { clanId: 2, name: 'Iron Guard', archetype: 'Cautious Accumulator', glyph: '⛨', accent: '#7a8a6a' },
  { clanId: 3, name: 'Crimson', archetype: 'Volatile Opportunist', glyph: '✦', accent: '#a85a5a' },
  { clanId: 4, name: 'Verdant Wardens', archetype: 'Patient Builder', glyph: '❦', accent: '#6aa888' },
] as const;

export function findElder(clanId: number): ElderDef | undefined {
  return ELDERS.find((e) => e.clanId === clanId);
}
