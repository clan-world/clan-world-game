/**
 * Roster of the four Elder clans the cockpit hardcodes (apps/server/convex
 * data is keyed by these clanIds 1-4). We keep the cockpit's clan names but
 * map each one to an archetype from the design archive's ARCHETYPE_GLYPHS
 * catalog so the mobile shell uses the design's runic mark + colour
 * vocabulary.
 */

export type ArchetypeKind =
  | 'patient-builder'
  | 'warlord'
  | 'diplomat'
  | 'hermit'
  | 'trickster'
  | 'verdant-warden';

export interface ElderDef {
  readonly clanId: number;
  readonly name: string;
  readonly archetype: ArchetypeKind;
}

export const ELDERS: ReadonlyArray<ElderDef> = [
  // The cockpit's "Aggressive Raider" reads cleanest as warlord.
  { clanId: 1, name: 'Storm Riders', archetype: 'warlord' },
  // "Cautious Accumulator" → patient-builder (slow accumulator per the design).
  { clanId: 2, name: 'Iron Guard', archetype: 'patient-builder' },
  // "Volatile Opportunist" → trickster (lies plausibly, two ledgers).
  { clanId: 3, name: 'Crimson', archetype: 'trickster' },
  // Direct match.
  { clanId: 4, name: 'Verdant Wardens', archetype: 'verdant-warden' },
] as const;

export function findElder(clanId: number): ElderDef | undefined {
  return ELDERS.find((e) => e.clanId === clanId);
}
