import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { tokens } from '@/theme/tokens';

const GLYPHS: Record<string, string> = {
  hearth: '🜂',
  hall: '⛨',
  bazaar: '⚖',
  treasury: '◈',
};

const LABELS: Record<string, string> = {
  hearth: 'HEARTH',
  hall: 'HALL',
  bazaar: 'BAZAAR',
  treasury: 'TREASURY',
};

/**
 * Custom bottom tab bar matching the design archive's `.tabbar` styling:
 * iron-deep ground, gold-primary top border, big runic glyphs over Cinzel
 * uppercase labels at 9px / 0.14em, vellum-gold for the active tab with a
 * short bright bar underneath.
 */
export function TabBar({ state, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  return (
    <View
      style={{
        flexDirection: 'row',
        backgroundColor: tokens.bg.canvas,
        borderTopColor: tokens.gold.primary,
        borderTopWidth: 1,
        paddingBottom: insets.bottom,
      }}
    >
      {state.routes.map((route, idx) => {
        const isFocused = state.index === idx;
        const label = LABELS[route.name] ?? route.name.toUpperCase();
        const glyph = GLYPHS[route.name] ?? '◇';

        const onPress = () => {
          const event = navigation.emit({
            type: 'tabPress',
            target: route.key,
            canPreventDefault: true,
          });
          if (!isFocused && !event.defaultPrevented) {
            navigation.navigate(route.name, route.params);
          }
        };

        return (
          <Pressable
            key={route.key}
            onPress={onPress}
            style={{
              flex: 1,
              height: 64,
              alignItems: 'center',
              justifyContent: 'center',
              gap: 4,
              paddingVertical: 6,
            }}
          >
            <Text
              style={{
                fontSize: 20,
                lineHeight: 22,
                color: isFocused ? tokens.gold.bright : tokens.ink.darkFaint,
              }}
            >
              {glyph}
            </Text>
            <Text
              style={{
                fontFamily: tokens.font.display,
                fontSize: 9,
                letterSpacing: 1.4,
                color: isFocused ? tokens.gold.bright : tokens.ink.darkFaint,
              }}
            >
              {label}
            </Text>
            {isFocused ? (
              <View
                style={{
                  position: 'absolute',
                  bottom: insets.bottom + 6,
                  height: 1,
                  width: 20,
                  backgroundColor: tokens.gold.bright,
                }}
              />
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}
