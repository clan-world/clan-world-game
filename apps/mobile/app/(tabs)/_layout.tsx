import { Tabs } from 'expo-router';
import { Text, View } from 'react-native';
import { tokens } from '@/theme/tokens';

/**
 * Custom tab bar styling — iron-deep ground with a vellum-gold accent on the
 * active tab. No Material defaults. Cinzel uppercase labels at 11px with the
 * letter-spacing the cockpit uses.
 */
export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: tokens.text.accent,
        tabBarInactiveTintColor: tokens.text.onIronDim,
        tabBarStyle: {
          backgroundColor: tokens.bg.ironDeep,
          borderTopColor: tokens.border.iron,
          borderTopWidth: 1,
          height: 60,
        },
        tabBarLabelStyle: {
          fontFamily: tokens.font.display,
          fontSize: 11,
          letterSpacing: 1.5,
          textTransform: 'uppercase',
        },
        tabBarIcon: () => null,
        sceneStyle: { backgroundColor: tokens.bg.void },
      }}
    >
      <Tabs.Screen name="hearth" options={{ title: 'Hearth' }} />
      <Tabs.Screen name="hall" options={{ title: 'Hall' }} />
      <Tabs.Screen name="cockpit" options={{ title: 'Cockpit' }} />
      <Tabs.Screen name="codex" options={{ title: 'Codex' }} />
    </Tabs>
  );
}

// Phase 1 placeholder helper used by the screen stubs below — keeps every
// tab screen visually consistent so the visual audit only has one card style
// to scrutinize.
export function PlaceholderPanel({ title, body }: { title: string; body: string }) {
  return (
    <View
      style={{
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: tokens.bg.void,
        paddingHorizontal: tokens.space.xl,
      }}
    >
      <View
        style={{
          backgroundColor: tokens.bg.parchment,
          borderColor: tokens.border.iron,
          borderWidth: 1,
          borderRadius: tokens.radius.md,
          padding: tokens.space.xl,
          gap: tokens.space.md,
          alignItems: 'center',
          maxWidth: 320,
          ...tokens.shadow.panel,
        }}
      >
        <Text
          style={{
            fontFamily: tokens.font.displayBold,
            fontSize: 18,
            color: tokens.text.onParchment,
            letterSpacing: 2,
            textTransform: 'uppercase',
          }}
        >
          {title}
        </Text>
        <Text
          style={{
            fontFamily: tokens.font.body,
            fontSize: 13,
            color: tokens.text.onParchmentDim,
            textAlign: 'center',
            lineHeight: 18,
          }}
        >
          {body}
        </Text>
      </View>
    </View>
  );
}
