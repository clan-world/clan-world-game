import React, { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { Inft } from '../data';
import { realClanIdOf } from '../clanData';
import { colors, fonts } from '../theme';
import { BridgeScreen } from './BridgeScreen';

const COCKPIT_URL =
  process.env.EXPO_PUBLIC_COCKPIT_URL ?? 'https://app-dev.clan-world.com/';
  // process.env.EXPO_PUBLIC_COCKPIT_URL ?? 'https://demo.clan-world.com/';

type Props = {
  inft: Inft;
  onClose: () => void;
  onWhisper: () => void;
};

/**
 * Slice 1: in-app WebView pointing at the live cockpit. No identity is
 * injected yet — the cockpit reads Convex anonymously, same as on desktop.
 *
 * The bridge (`window.__clanworld` injected pubkey/loadedClanId) is a slice 2
 * coordinated change with apps/web. For now we just open the URL plain and
 * let the user swipe through the snap-pager to find their loaded clan.
 */
export const CockpitScreen = ({ inft, onClose, onWhisper }: Props) => {
  const [loaded, setLoaded] = useState(false);
  const realClanId = realClanIdOf(inft);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bgTerminal }}>
      {/* Native chrome — back to hall + clan label + whisper icon */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingHorizontal: 12,
          paddingVertical: 8,
          backgroundColor: 'rgba(15,14,18,0.92)',
          borderBottomWidth: 1,
          borderBottomColor: 'rgba(212,175,92,0.3)',
        }}
      >
        <Pressable onPress={onClose} hitSlop={8}>
          <Text
            style={{
              fontFamily: fonts.display,
              fontSize: 13,
              color: colors.goldPrimary,
              letterSpacing: 1.4,
            }}
          >
            ← HALL
          </Text>
        </Pressable>
        <Text style={{ fontFamily: fonts.mono, fontSize: 10, color: colors.inkMono }}>
          {inft.name.toUpperCase()}
          {realClanId !== null ? ` · CLAN ${realClanId}` : ''}
        </Text>
        <Pressable onPress={onWhisper} hitSlop={8}>
          <Text style={{ fontSize: 16, color: colors.goldBright }}>♪</Text>
        </Pressable>
      </View>

      {/* WebView. BridgeScreen overlays until first onLoadEnd. */}
      <View style={{ flex: 1 }}>
        {!loaded && (
          <View
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              zIndex: 10,
            }}
          >
            <BridgeScreen />
          </View>
        )}
        <WebView
          source={{ uri: COCKPIT_URL }}
          onLoadEnd={() => setLoaded(true)}
          style={{ flex: 1, opacity: loaded ? 1 : 0, backgroundColor: colors.bgTerminal }}
          javaScriptEnabled
          domStorageEnabled
          sharedCookiesEnabled
          thirdPartyCookiesEnabled
          startInLoadingState={false}
        />
      </View>
    </View>
  );
};
