import { Pressable, Text, View } from 'react-native';
import type { PressableProps } from 'react-native';
import { tokens } from '@/theme/tokens';

type Props = {
  label: string;
  onPress: PressableProps['onPress'];
  disabled?: boolean;
  testID?: string;
};

/**
 * Parchment-faced primary button. Matches the cockpit's panel chrome:
 * parchment over iron border, hand-cut radius, no pillowy edges.
 */
export function PrimaryButton({ label, onPress, disabled, testID }: Props) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      testID={testID}
      style={({ pressed }) => ({
        opacity: disabled ? 0.4 : pressed ? 0.85 : 1,
      })}
    >
      <View
        style={{
          backgroundColor: tokens.bg.parchment,
          borderColor: tokens.border.iron,
          borderWidth: 1,
          borderRadius: tokens.radius.md,
          paddingVertical: tokens.space.md,
          paddingHorizontal: tokens.space.xl,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Text
          style={{
            fontFamily: tokens.font.displayBold,
            color: tokens.text.onParchment,
            fontSize: 13,
            letterSpacing: 2,
            textTransform: 'uppercase',
          }}
        >
          {label}
        </Text>
      </View>
    </Pressable>
  );
}
