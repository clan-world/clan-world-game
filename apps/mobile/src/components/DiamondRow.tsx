import { View } from 'react-native';
import { Diamond } from './Diamond';
import { tokens } from '@/theme/tokens';

type Props = {
  count?: number;
  color?: string;
  size?: number;
};

/**
 * Three diamonds (or N) framed by a fading horizontal rule on each side.
 * Used as a section separator on the splash and major panels.
 */
export function DiamondRow({
  count = 3,
  color = tokens.gold.primary,
  size = 6,
}: Props) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 14,
      }}
    >
      <View
        style={{
          flex: 1,
          maxWidth: 80,
          height: 1,
          backgroundColor: color,
          opacity: 0.4,
        }}
      />
      {Array.from({ length: count }).map((_, i) => (
        <Diamond key={i} size={size} color={color} />
      ))}
      <View
        style={{
          flex: 1,
          maxWidth: 80,
          height: 1,
          backgroundColor: color,
          opacity: 0.4,
        }}
      />
    </View>
  );
}
