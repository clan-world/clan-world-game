/**
 * Agent Control Page — extended design tokens.
 *
 * Aesthetic: "Forge Terminal" — a blacksmith's command console where ancient
 * runes meet a hot-metal HUD. Built on top of the existing cockpit-tokens
 * parchment-on-iron palette, but pushed into deeper obsidian + ember + rune
 * cyan for the agent control surface.
 *
 * Why a second token sheet (not just extending cockpit-tokens):
 *   - The cockpit speaks to four elders at once — parchment-bright, info-dense.
 *   - The agent control page is intimate, ritualistic, single-elder. It wants
 *     a darker, hotter, more focused palette so the player FEELS like they're
 *     standing at a forge whispering into the iron.
 */
export const agentTokens = {
  // Foundation — deeper than cockpit. Obsidian, smelted iron.
  bg: {
    obsidian: '#08070a',          // page background, deepest
    iron: '#15110e',              // panel face
    ironRaised: '#1d1813',        // raised cards inside panels
    ember: '#2a1410',             // hot zones (active cooldown, errors)
    seal:  '#0d0a08',             // modal scrim
  },
  // Accent — hot metal vs cold rune
  ember: {
    core:  '#ff6b35',             // primary ember (burns, send button)
    glow:  '#ff8a55',             // hover / glow halo
    deep:  '#b34423',             // pressed
    dim:   '#6b2614',             // muted ember (disabled)
  },
  rune: {
    core:  '#5fc5d4',             // AI / NFT / arcane signal
    glow:  '#8ce0ec',             // pulse highlight
    deep:  '#2d6f7a',             // muted rune
  },
  gold: {
    core:  '#d4a04a',             // GOLD currency
    bright:'#f0c168',             // GOLD bounce highlight
    deep:  '#7a5a20',             // muted gold
  },
  text: {
    primary:   '#e6dccd',         // bright parchment text on dark
    secondary: '#a89b85',         // dimmer
    muted:     '#6b5e48',         // labels
    danger:    '#ff5050',         // errors
    success:   '#8cd87a',         // success
    onEmber:   '#100806',         // text on bright ember button
  },
  // Parchment palette — for the hero "writ of {agent}" letter card. Mirrors
  // the slice-1 design system's parchment + ink tokens so the letter feels
  // visually continuous with the mobile mockups.
  parchment: {
    base:   '#e8dec7',
    mid:    '#d8c79f',
    shade:  '#c8b58e',
  },
  ink: {
    primary:   '#2a1f10',
    secondary: '#4a3820',
    tertiary:  '#6a532f',
  },
  border: {
    iron:           '#2e2820',
    ironLight:      '#42392c',
    rune:           'rgba(95, 197, 212, 0.32)',
    runeStrong:     'rgba(95, 197, 212, 0.55)',
    ember:          'rgba(255, 107, 53, 0.42)',
    hairline:       'rgba(212, 160, 74, 0.16)',
    hairlineMid:    'rgba(212, 160, 74, 0.30)',
    hairlineStrong: 'rgba(212, 160, 74, 0.55)',
  },
  // Typography. The slice-1 design system pairs Cinzel (display) with
  // Cormorant Garamond (italic script — for ritual / poetic moments) and
  // EB Garamond (body — long-form ink-on-parchment). JetBrains Mono for
  // technical readouts, Uncial Antiqua for runes.
  font: {
    display: '"Cinzel", "Times New Roman", serif',
    rune:    '"Uncial Antiqua", "Cinzel", serif',
    body:    '"EB Garamond", "Times New Roman", serif',
    bodyUi:  '"Inter", system-ui, sans-serif',  // legacy alias for non-ritual UI
    script:  '"Cormorant Garamond", "EB Garamond", serif',
    mono:    '"JetBrains Mono", "SF Mono", Consolas, monospace',
  },
  space: {
    xs: '4px', sm: '8px', md: '12px', lg: '16px', xl: '20px', xxl: '28px',
  },
  radius: {
    sm: '2px', md: '4px', lg: '8px',
  },
  shadow: {
    panel:      '0 2px 14px rgba(0,0,0,0.7), inset 0 1px 0 rgba(255,180,120,0.05)',
    embered:    '0 0 24px rgba(255,107,53,0.28), 0 2px 14px rgba(0,0,0,0.7)',
    runed:      '0 0 18px rgba(95,197,212,0.22), 0 2px 12px rgba(0,0,0,0.6)',
    inset:      'inset 0 0 0 1px rgba(255,180,120,0.04)',
  },
} as const;

/** Whisper economy. */
export const WHISPER_BURN = 5;
export const WHISPER_COOLDOWN_MS = 10 * 60 * 1000; // 10 minutes
export const SKIP_TAX_PER_FULL_MINUTE = 1000;

/** Faucet. */
export const FAUCET_DROP = 10_000;

/** Mock initial wallet. */
export const INITIAL_GOLD = 14_750;
export const MOCK_WALLET = 'CLwS3vKy8Pp4gXNqHdF7mBaR9TtZjYwLkE2QrUuVnVwH';

/** Per-elder mock essence — gives the user something to overwrite. */
export const MOCK_ESSENCE: Record<number, { strategy: string; notes: string }> = {
  1: {
    strategy:
      "Forest economy first. Build wood vault to 50, secure forest perimeter. Ally with clan-2 if Iron Guard whispers cooperation by tick 80. Don't trust clan-3 — Crimson burns bridges by tick 60 every season.",
    notes:
      "Crimson owes 8 wood from T42 trade. Iron Guard prefers ore-for-wood at 3:1. Verdant Wardens reliable on truces but slow to strike — don't lean on them for raid cover.",
  },
  2: {
    strategy:
      "Patient stockpile. Hold ore at 240+ before any trade. Defensive posture until tick 90, then exploit whoever starves first. Never raid first — counter-raid only.",
    notes:
      "Storm Riders aggressive on T20-40, then exhausted. Crimson volatile — never trust truce past tick 70. Verdant Wardens make solid 3-clan defensive pacts.",
  },
  3: {
    strategy:
      "Volatility is leverage. Burn one bridge per season for shock value. Raid the weakest stockpile at tick 70. Don't hoard — convert wins into pressure immediately.",
    notes:
      "Storm Riders mirror our energy — match their tempo, then break it. Iron Guard slow to react; raid them before tick 80 for clean wins. Verdant Wardens hold grudges.",
  },
  4: {
    strategy:
      "Build for the long arc. Wood + ore parity by tick 60. Form a 3-clan defensive pact early, then break it the season AFTER everyone trusts us. Patience compounds.",
    notes:
      "Truces hold us back if we keep them past tick 100. Storm Riders predictable raiders — let them tire on Iron Guard. Crimson hates being mirrored — lean into it.",
  },
};

export interface AgentDef {
  id: number;
  name: string;
  archetype: string;
  glyph: string;
  accent: string;
  rune: string;             // Uncial-style 3-char rune signature
  oneLineEssence: string;   // poetic one-liner under name
}

export const AGENTS: ReadonlyArray<AgentDef> = [
  { id: 1, name: 'Storm Riders',    archetype: 'Aggressive Raider',    glyph: '⚡', accent: '#5a8aa8', rune: 'ᚦᚱᛏ', oneLineEssence: 'thunder, then rain' },
  { id: 2, name: 'Iron Guard',      archetype: 'Cautious Accumulator', glyph: '⛨', accent: '#7a8a6a', rune: 'ᛁᚷᚱ', oneLineEssence: 'patience over plunder' },
  { id: 3, name: 'Crimson',         archetype: 'Volatile Opportunist', glyph: '✦', accent: '#a85a5a', rune: 'ᚲᚱᛗ', oneLineEssence: 'burn one bridge a season' },
  { id: 4, name: 'Verdant Wardens', archetype: 'Patient Builder',      glyph: '❦', accent: '#6aa888', rune: 'ᚹᛞᚾ', oneLineEssence: 'the slow vine breaks the stone' },
] as const;

export function findAgent(id: number): AgentDef | undefined {
  return AGENTS.find((a) => a.id === id);
}
