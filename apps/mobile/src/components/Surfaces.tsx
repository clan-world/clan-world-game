import { View } from 'react-native';
import type { ViewProps } from 'react-native';
import { tokens } from '@/theme/tokens';

type SurfaceProps = ViewProps & {
  children?: React.ReactNode;
  /** Use the dimmer parchment-deep variant. */
  deep?: boolean;
};

/**
 * Parchment surface — warm aged-paper face with a subtle inner glow. The
 * design archive layers SVG noise over a radial highlight; in RN we cheat
 * with two stacked translucent overlays plus a deep-edge background.
 */
export function Parchment({ deep = false, style, children, ...rest }: SurfaceProps) {
  const base = deep ? tokens.bg.parchmentDim : tokens.bg.parchment;
  return (
    <View
      {...rest}
      style={[
        {
          backgroundColor: base,
          borderColor: tokens.gold.primary,
          borderWidth: 1,
          borderRadius: tokens.radius.sm,
          padding: tokens.space.lg,
          overflow: 'hidden',
        },
        style,
      ]}
    >
      {/* Highlight glow in the upper-left — mimics the design's CSS
          `radial-gradient(ellipse at 30% 20%, rgba(255,240,200,0.18))`. */}
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '70%',
          height: '60%',
          backgroundColor: 'rgba(255, 240, 200, 0.18)',
          borderBottomRightRadius: 200,
        }}
      />
      {children}
    </View>
  );
}

/**
 * Stone surface — the dark elevated card. Used for terminal panels, modal
 * sheets, and toasts.
 */
export function Stone({ style, children, ...rest }: SurfaceProps) {
  return (
    <View
      {...rest}
      style={[
        {
          backgroundColor: tokens.bg.elevated,
          borderColor: tokens.border.goldSoft,
          borderWidth: 1,
          borderRadius: tokens.radius.sm,
          padding: tokens.space.lg,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}
