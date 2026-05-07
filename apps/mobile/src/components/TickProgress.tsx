import { View } from 'react-native';
import { tokens } from '@/theme/tokens';

type Props = {
  /** 0..1 — clamped if outside the range. */
  pct: number;
  /** Use the parchment-friendly track colour. */
  light?: boolean;
};

/**
 * Thin horizontal bar with a gold gradient fill. Used for season progress
 * and any other "fraction-of-tick" indicators.
 */
export function TickProgress({ pct, light = false }: Props) {
  const clamped = Math.max(0, Math.min(1, pct));
  return (
    <View
      style={{
        height: 3,
        backgroundColor: light
          ? 'rgba(26, 20, 16, 0.15)'
          : 'rgba(212, 175, 92, 0.2)',
        overflow: 'hidden',
      }}
    >
      <View
        style={{
          width: `${clamped * 100}%`,
          height: '100%',
          backgroundColor: tokens.gold.bright,
        }}
      />
    </View>
  );
}
