import { Tabs } from 'expo-router';
import { TabBar } from '@/components/TabBar';
import { tokens } from '@/theme/tokens';

/**
 * Four-tab shell mirroring the design archive: HEARTH / HALL / BAZAAR /
 * TREASURY. Cockpit and Codex live OUTSIDE the tab bar — Cockpit is
 * launched from Hearth's Hero "Enter Cockpit" button (full-screen modal
 * route), Codex from the gear icon in the Hearth top bar.
 */
export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: tokens.bg.canvas },
      }}
      tabBar={(props) => <TabBar {...props} />}
    >
      <Tabs.Screen name="hearth" />
      <Tabs.Screen name="hall" />
      <Tabs.Screen name="bazaar" />
      <Tabs.Screen name="treasury" />
    </Tabs>
  );
}
