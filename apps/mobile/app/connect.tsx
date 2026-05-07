import { useEffect } from 'react';
import { Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { PrimaryButton } from '@/components/PrimaryButton';
import { useWallet } from '@/hooks/useWallet';
import { tokens } from '@/theme/tokens';

export default function ConnectScreen() {
  const router = useRouter();
  const { state, connect } = useWallet();

  // Once the user is connected, route to the tabs. Light haptic on success
  // matches the cockpit's tactile language for state transitions.
  useEffect(() => {
    if (state.status === 'connected') {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.replace('/(tabs)/hearth');
    }
  }, [state.status, router]);

  const isConnecting = state.status === 'connecting';
  const errorMessage =
    state.status === 'error' ? state.error.message : null;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: tokens.bg.void }}>
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          paddingHorizontal: tokens.space.xl,
          gap: tokens.space.xl,
        }}
      >
        <View style={{ alignItems: 'center', gap: tokens.space.md }}>
          <Text
            style={{
              fontFamily: tokens.font.display,
              fontSize: 32,
              color: tokens.text.accent,
              letterSpacing: 4,
              textTransform: 'uppercase',
            }}
          >
            Clan World
          </Text>
          <Text
            style={{
              fontFamily: tokens.font.body,
              fontSize: 14,
              color: tokens.text.onIron,
              letterSpacing: 1,
              textAlign: 'center',
            }}
          >
            Enter the realm.
          </Text>
        </View>

        <PrimaryButton
          label={isConnecting ? 'Awaiting wallet…' : 'Connect Wallet'}
          onPress={connect}
          disabled={isConnecting}
          testID="connect-button"
        />

        {errorMessage ? (
          <Text
            style={{
              fontFamily: tokens.font.mono,
              fontSize: 11,
              color: tokens.text.danger,
              letterSpacing: 0.5,
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
            fontSize: 10,
            color: tokens.text.onIronDim,
            letterSpacing: 1,
          }}
        >
          DEVNET · MOBILE WALLET ADAPTER
        </Text>
      </View>
    </SafeAreaView>
  );
}
