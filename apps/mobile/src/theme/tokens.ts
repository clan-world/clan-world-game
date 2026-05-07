/**
 * Design tokens — pulled verbatim from the "Clan World RN Shell" design
 * archive (`artifacts/Clan World RN Shell.zip` → `project/styles.css`).
 *
 * Replacing the old cockpit-token mirror: per the user's redesign brief,
 * the mobile shell now follows this design language, not the desktop
 * cockpit's parchment-on-iron-frame aesthetic. Both still feel
 * "ClanWorld," but they are deliberately not pixel-aligned.
 */

export const tokens = {
  bg: {
    canvas: '#0B0A0E',
    elevated: '#15131A',
    elevated2: '#1C1922',
    parchment: '#E8DAB1',
    parchmentDim: '#C7B27C',
    parchmentDeep: '#B59E68',
    terminal: '#0F0E12',

    // Aliases for cross-screen consistency. Existing callers used `void`;
    // the design's `canvas` is the same role.
    void: '#0B0A0E',
    aubergineDeep: '#2A1F3D',
  },
  ink: {
    parchment: '#1A1410',
    parchmentMuted: '#5A4A35',
    parchmentFaint: '#8A7752',
    dark: '#E8DDC4',
    darkMuted: '#9A8E72',
    darkFaint: '#5C5443',
    mono: '#D4AF5C',
  },
  gold: {
    primary: '#D4AF5C',
    bright: '#E8C77E',
    deep: '#8C6F3A',
    deeper: '#5E4920',
  },
  script: {
    blue: '#6B7DB8',
    blueMuted: '#3A4A7A',
  },
  status: {
    live: '#6B8E5C',
    warn: '#C99B4F',
    danger: '#A04A3F',
    info: '#5A7BA8',
  },
  // Convenience aliases mapping legacy callsites to new token names.
  // Removed once every screen uses the design's vocabulary directly.
  text: {
    onParchment: '#1A1410',
    onParchmentDim: '#5A4A35',
    onIron: '#E8DDC4',
    onIronDim: '#9A8E72',
    accent: '#D4AF5C',
    danger: '#A04A3F',
    muted: '#5C5443',
  },
  border: {
    gold: '#D4AF5C',
    goldSoft: 'rgba(212, 175, 92, 0.35)',
    goldDeep: '#8C6F3A',
    parchmentEdge: 'rgba(26, 20, 16, 0.25)',
    iron: '#3A3528',
    ironLight: '#4A4232',
  },
  font: {
    display: 'Cinzel_500Medium',
    displaySemi: 'Cinzel_600SemiBold',
    displayBold: 'Cinzel_700Bold',
    script: 'CormorantGaramond_500Medium_Italic',
    scriptBold: 'CormorantGaramond_600SemiBold_Italic',
    body: 'EBGaramond_400Regular',
    bodyMedium: 'EBGaramond_500Medium',
    bodyBold: 'EBGaramond_600SemiBold',
    bodyItalic: 'EBGaramond_400Regular_Italic',
    mono: 'JetBrainsMono_400Regular',
    monoMedium: 'JetBrainsMono_500Medium',
    monoBold: 'JetBrainsMono_600SemiBold',
  },
  space: {
    xs: 4,
    sm: 8,
    md: 12,
    lg: 16,
    xl: 24,
    xxl: 32,
  },
  radius: {
    sm: 2,
    md: 4,
  },
  shadow: {
    panel: {
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 8 },
      shadowOpacity: 0.5,
      shadowRadius: 28,
      elevation: 8,
    },
  },
} as const;

export type Tokens = typeof tokens;
