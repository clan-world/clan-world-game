import { Pressable, Text, View } from 'react-native';
import type { ReactNode } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { tokens } from '@/theme/tokens';

type Props = {
  title: string;
  /** Optional secondary label rendered in mono under the title. */
  sub?: string;
  /** Show a left-side back chevron and call onBack when tapped. */
  onBack?: () => void;
  /** Right-side slot for action buttons (icons / chips). */
  right?: ReactNode;
};

/**
 * App-level top bar. Title in Cinzel, optional mono subtitle, optional
 * back chevron and right-side action row. Includes the safe-area top
 * inset so the same component works on every screen.
 */
export function TopBar({ title, sub, onBack, right }: Props) {
  const insets = useSafeAreaInsets();
  return (
    <View
      style={{
        backgroundColor: tokens.bg.canvas,
        borderBottomColor: 'rgba(212, 175, 92, 0.15)',
        borderBottomWidth: 1,
        paddingTop: insets.top,
      }}
    >
      <View
        style={{
          height: 52,
          paddingHorizontal: 16,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          {onBack ? (
            <Pressable onPress={onBack} hitSlop={12}>
              <Text
                style={{
                  fontSize: 18,
                  color: tokens.gold.primary,
                  paddingHorizontal: 4,
                }}
              >
                ←
              </Text>
            </Pressable>
          ) : null}
          <View>
            <Text
              style={{
                fontFamily: tokens.font.display,
                fontSize: 11,
                color: tokens.ink.dark,
                letterSpacing: 1.8,
                textTransform: 'uppercase',
              }}
            >
              {title}
            </Text>
            {sub ? (
              <Text
                style={{
                  fontFamily: tokens.font.mono,
                  fontSize: 9,
                  color: tokens.ink.darkMuted,
                  marginTop: 2,
                }}
              >
                {sub}
              </Text>
            ) : null}
          </View>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          {right}
        </View>
      </View>
    </View>
  );
}
