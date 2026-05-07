import { useMemo } from 'react';
import { Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { WebView } from 'react-native-webview';
import { TopBar } from '@/components/TopBar';
import { Parchment } from '@/components/Surfaces';
import { Button } from '@/components/Button';
import { Pill } from '@/components/Pill';
import { useFollowedClan } from '@/hooks/useFollowedClan';
import { useWallet } from '@/hooks/useWallet';
import {
  buildCockpitUrl,
  buildInjectionScript,
  SHELL_USER_AGENT_SUFFIX,
} from '@/lib/webview-bridge';
import { findElder } from '@/theme/elders';
import { tokens } from '@/theme/tokens';

const COCKPIT_URL =
  process.env.EXPO_PUBLIC_COCKPIT_URL ?? 'https://demo.clan-world.com/cockpit';

export default function CockpitScreen() {
  const router = useRouter();
  const { state } = useWallet();
  const { clanId } = useFollowedClan();
  const followedElder = clanId ? findElder(clanId) : null;

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

  if (!clanId || !followedElder) {
    return (
      <View style={{ flex: 1, backgroundColor: tokens.bg.canvas }}>
        <TopBar
          title="COCKPIT"
          onBack={() => router.back()}
        />
        <View
          style={{
            flex: 1,
            padding: 24,
            justifyContent: 'center',
            gap: 16,
          }}
        >
          <Parchment deep>
            <Text
              style={{
                fontFamily: tokens.font.script,
                fontSize: 18,
                color: tokens.script.blueMuted,
                textAlign: 'center',
              }}
            >
              No Elder claimed.
            </Text>
            <Text
              style={{
                fontFamily: tokens.font.body,
                fontSize: 13,
                color: tokens.ink.parchment,
                textAlign: 'center',
                marginTop: 8,
              }}
            >
              Open the Hall and follow one to enter their cockpit.
            </Text>
            <View style={{ height: 12 }} />
            <Button
              label="Go To The Hall"
              onPress={() => router.replace('/(tabs)/hall')}
              variant="primary"
              block
            />
          </Parchment>
        </View>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: tokens.bg.canvas }}>
      <TopBar
        title={followedElder.name.toUpperCase()}
        sub={`tick · live · clan #${followedElder.clanId}`}
        onBack={() => router.back()}
        right={<Pill kind="live">● LIVE</Pill>}
      />
      <WebView
        source={{ uri: url }}
        injectedJavaScriptBeforeContentLoaded={injection}
        javaScriptEnabled
        domStorageEnabled
        thirdPartyCookiesEnabled
        sharedCookiesEnabled
        applicationNameForUserAgent={SHELL_USER_AGENT_SUFFIX}
        style={{ flex: 1, backgroundColor: tokens.bg.canvas }}
        bounces={false}
        originWhitelist={['*']}
      />
    </View>
  );
}
