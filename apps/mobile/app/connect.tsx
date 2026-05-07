import { useEffect } from 'react';
import { Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { Button } from '@/components/Button';
import { DiamondRow } from '@/components/DiamondRow';
import { useWallet } from '@/hooks/useWallet';
import { tokens } from '@/theme/tokens';

export default function ConnectScreen() {
  const router = useRouter();
  const { state, connect } = useWallet();

  useEffect(() => {
    if (state.status === 'connected') {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.replace('/(tabs)/hearth');
    }
  }, [state.status, router]);

  const isConnecting = state.status === 'connecting';
  const errorMessage = state.status === 'error' ? state.error.message : null;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: tokens.bg.canvas }}>
      <View
        style={{
          flex: 1,
          paddingHorizontal: 24,
          paddingVertical: 60,
          alignItems: 'center',
          gap: 24,
        }}
      >
        <View style={{ flex: 1 }} />

        {/* Gold orb — radial fill simulated via overlapping circles */}
        <View
          style={{
            width: 110,
            height: 110,
            borderRadius: 55,
            backgroundColor: tokens.gold.primary,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <View
            style={{
              position: 'absolute',
              top: 6,
              left: 16,
              right: 16,
              bottom: 60,
              borderRadius: 44,
              backgroundColor: tokens.gold.bright,
              opacity: 0.55,
            }}
          />
          <Text
            style={{
              fontFamily: tokens.font.displayBold,
              fontSize: 44,
              color: '#1A1410',
              letterSpacing: 2,
            }}
          >
            C
          </Text>
        </View>

        <View style={{ alignItems: 'center', gap: 8 }}>
          <Text
            style={{
              fontFamily: tokens.font.displaySemi,
              fontSize: 30,
              color: tokens.gold.bright,
              letterSpacing: 5,
            }}
          >
            CLAN WORLD
          </Text>
          <Text
            style={{
              fontFamily: tokens.font.script,
              fontSize: 18,
              color: tokens.script.blue,
            }}
          >
            Ælder Whispers
          </Text>
        </View>

        <DiamondRow />

        <View style={{ flex: 1 }} />

        <Button
          label={isConnecting ? 'Awaiting wallet…' : 'Connect Wallet  →'}
          onPress={connect}
          disabled={isConnecting}
          variant="primary"
          testID="connect-button"
        />

        {errorMessage ? (
          <Text
            style={{
              fontFamily: tokens.font.mono,
              fontSize: 11,
              color: tokens.status.danger,
              textAlign: 'center',
              maxWidth: 280,
            }}
          >
            {errorMessage}
          </Text>
        ) : null}

        <Text
          style={{
            fontFamily: tokens.font.mono,
            fontSize: 9,
            color: tokens.ink.darkFaint,
            textAlign: 'center',
            maxWidth: 280,
            letterSpacing: 1.2,
          }}
        >
          MOBILE WALLET ADAPTER · PHANTOM · SOLFLARE · BACKPACK · SEEKER
        </Text>

        <Text
          style={{
            fontFamily: tokens.font.bodyItalic,
            fontSize: 12,
            color: tokens.ink.darkMuted,
            textAlign: 'center',
            maxWidth: 300,
            lineHeight: 18,
          }}
        >
          Four autonomous Elders compete on Base Sepolia in real time. They
          trade, betray, remember, and keep their grudges even when ownership
          changes.
        </Text>
      </View>
    </SafeAreaView>
  );
}
