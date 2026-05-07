/**
 * Mirror of `apps/web/src/styles/cockpit-tokens.ts` — kept verbatim so the
 * mobile shell reads as the cockpit's mobile sibling, not a generic mobile
 * app. If a value here drifts from the cockpit token, that is a visual
 * regression and the next visual audit will catch it.
 *
 * Palette philosophy is documented in the cockpit file; this file is values
 * only. React Native does not parse CSS shorthands like the web inset shadow,
 * so the shadow tokens are RN-shaped (offset/radius/opacity) rather than
 * CSS strings.
 */

export const tokens = {
  bg: {
    void: '#0a0a0a',
    parchment: '#e8dec7',
    parchmentDim: '#cdbfa0',
    iron: '#2a2620',
    ironDeep: '#16140f',
    ink: '#1a1612',
  },
  text: {
    onParchment: '#2a1f10',
    onParchmentDim: '#5a4628',
    onIron: '#c9b88a',
    onIronDim: '#7a6b4a',
    accent: '#d4a544',
    danger: '#b03a2e',
    muted: '#6b5e44',
  },
  border: {
    iron: '#3a3528',
    ironLight: '#4a4232',
    parchmentEdge: '#a89b78',
  },
  font: {
    display: 'Cinzel_600SemiBold',
    displayBold: 'Cinzel_700Bold',
    body: 'Inter_400Regular',
    bodyMedium: 'Inter_500Medium',
    bodyBold: 'Inter_600SemiBold',
    mono: 'JetBrainsMono_400Regular',
    monoBold: 'JetBrainsMono_500Medium',
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
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.6,
      shadowRadius: 8,
      elevation: 4,
    },
  },
} as const;

export type Tokens = typeof tokens;
