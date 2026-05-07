import { Pressable, Text } from 'react-native';
import type { PressableProps } from 'react-native';
import { tokens } from '@/theme/tokens';

type Variant = 'primary' | 'secondary' | 'ghost';

type Props = {
  label: string;
  onPress: PressableProps['onPress'];
  variant?: Variant;
  disabled?: boolean;
  block?: boolean;
  testID?: string;
};

const STYLES: Record<
  Variant,
  { bg: string; border: string; fg: string }
> = {
  primary: {
    bg: '#1A1410',
    border: tokens.gold.primary,
    fg: tokens.gold.bright,
  },
  secondary: {
    bg: 'transparent',
    border: 'rgba(212, 175, 92, 0.55)',
    fg: tokens.ink.dark,
  },
  ghost: {
    bg: 'transparent',
    border: 'transparent',
    fg: tokens.gold.primary,
  },
};

/**
 * Button matching the design archive's `.btn` aesthetic — Cinzel uppercase
 * with wide letter-spacing, gold border, dark face, no rounded pills.
 */
export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled,
  block,
  testID,
}: Props) {
  const s = STYLES[variant];
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      testID={testID}
      style={({ pressed }) => ({
        opacity: disabled ? 0.4 : pressed ? 0.85 : 1,
        backgroundColor: s.bg,
        borderColor: s.border,
        borderWidth: variant === 'ghost' ? 0 : 1,
        borderRadius: tokens.radius.sm,
        paddingVertical: tokens.space.md,
        paddingHorizontal: tokens.space.lg,
        alignItems: 'center',
        justifyContent: 'center',
        alignSelf: block ? 'stretch' : 'flex-start',
      })}
    >
      <Text
        style={{
          fontFamily: tokens.font.display,
          color: s.fg,
          fontSize: 12,
          letterSpacing: 1.7,
          textTransform: 'uppercase',
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}
