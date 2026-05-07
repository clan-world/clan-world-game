import { useMemo } from 'react';
import { Text, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import { useFollowedClan } from '@/hooks/useFollowedClan';
import { useWallet } from '@/hooks/useWallet';
import {
  buildCockpitUrl,
  buildInjectionScript,
  SHELL_USER_AGENT_SUFFIX,
} from '@/lib/webview-bridge';
import { tokens } from '@/theme/tokens';

const COCKPIT_URL =
  process.env.EXPO_PUBLIC_COCKPIT_URL ?? 'https://demo.clan-world.com/cockpit';

export default function Cockpit() {
  const { state } = useWallet();
  const { clanId } = useFollowedClan();
  const insets = useSafeAreaInsets();

  const url = useMemo(() => buildCockpitUrl(COCKPIT_URL, clanId), [clanId]);
  const injection = useMemo(
    () =>
      buildInjectionScript({
        shell: 'react-native-android',
        walletPubkey: state.status === 'connected' ? state.pubkey : null,
        followedClanId: clanId,
        capabilities: ['haptics'],
      }),
    [state, clanId],
  );

  if (!clanId) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: tokens.bg.void }}>
        <View
          style={{
            flex: 1,
            alignItems: 'center',
            justifyContent: 'center',
            paddingHorizontal: tokens.space.xl,
            gap: tokens.space.md,
          }}
        >
          <Text
            style={{
              fontFamily: tokens.font.displayBold,
              fontSize: 16,
              color: tokens.text.onIron,
              letterSpacing: 2,
              textTransform: 'uppercase',
            }}
          >
            No clan selected
          </Text>
          <Text
            style={{
              fontFamily: tokens.font.body,
              fontSize: 13,
              color: tokens.text.onIronDim,
              textAlign: 'center',
              maxWidth: 280,
              lineHeight: 18,
            }}
          >
            Visit the Hall and tap Follow on an Elder to load their cockpit
            here.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: tokens.bg.void,
        // Pad the top so the WebView doesn't draw under the status bar.
        // The tab bar already lives below; bottom inset handled by Expo Router.
        paddingTop: insets.top,
      }}
    >
      <WebView
        // Per slice spec §10.2: shared cookies + DOM storage + JS enabled
        // are required for Convex websockets to live inside react-native-webview.
        source={{ uri: url }}
        injectedJavaScriptBeforeContentLoaded={injection}
        javaScriptEnabled
        domStorageEnabled
        thirdPartyCookiesEnabled
        sharedCookiesEnabled
        // Custom UA so the cockpit can branch on shell context if it wants.
        applicationNameForUserAgent={SHELL_USER_AGENT_SUFFIX}
        style={{ flex: 1, backgroundColor: tokens.bg.void }}
        // Don't auto-bounce on overscroll — looks janky inside a tab.
        bounces={false}
        // Allow the cockpit's own iframes (ttyd terminals etc.) to render.
        originWhitelist={['*']}
      />
    </View>
  );
}
