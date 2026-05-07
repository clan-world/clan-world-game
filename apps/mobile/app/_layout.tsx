// IMPORTANT: polyfills MUST be the first import in the entry layout. They
// install global.Buffer + crypto.getRandomValues that @solana/web3.js calls
// during module init. If imported after web3.js, the app boots with broken
// crypto and signing fails silently.
import '@/lib/polyfills';

import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ConvexProvider } from 'convex/react';
import { fontMap } from '@/theme/fonts';
import { tokens } from '@/theme/tokens';
import { WalletProvider } from '@/hooks/useWallet';
import { FollowedClanProvider } from '@/hooks/useFollowedClan';
import { convex } from '@/lib/convex';

SplashScreen.preventAutoHideAsync().catch(() => {
  // On reload during dev, the splash may already be hidden. Swallow.
});

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts(fontMap);

  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync().catch(() => {});
    }
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) {
    return null;
  }

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: tokens.bg.void }}>
      <SafeAreaProvider>
        <StatusBar style="light" />
        <ConvexProvider client={convex}>
          <WalletProvider>
            <FollowedClanProvider>
              <Stack
                screenOptions={{
                  headerShown: false,
                  contentStyle: { backgroundColor: tokens.bg.void },
                  animation: 'fade',
                }}
              />
            </FollowedClanProvider>
          </WalletProvider>
        </ConvexProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
