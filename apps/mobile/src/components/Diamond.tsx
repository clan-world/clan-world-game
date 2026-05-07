import { View } from 'react-native';
import type { ViewStyle } from 'react-native';
import { tokens } from '@/theme/tokens';

type Props = {
  size?: number;
  color?: string;
  style?: ViewStyle;
};

/**
 * 45°-rotated square — the design archive's signature ornament. Used as
 * bullets, list markers, and the active-tab indicator.
 */
export function Diamond({ size = 6, color = tokens.gold.primary, style }: Props) {
  return (
    <View
      style={[
        {
          width: size,
          height: size,
          backgroundColor: color,
          transform: [{ rotate: '45deg' }],
        },
        style,
      ]}
    />
  );
}
