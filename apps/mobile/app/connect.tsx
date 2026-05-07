import { Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { PrimaryButton } from '@/components/PrimaryButton';
import { tokens } from '@/theme/tokens';

export default function ConnectScreen() {
  const router = useRouter();

  // Phase 1 stub: button just routes to the tabs without doing MWA. Phase 2
  // replaces this with a real wallet connection flow.
  const handleConnect = () => {
    router.replace('/(tabs)/hearth');
  };

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
          label="Connect Wallet"
          onPress={handleConnect}
          testID="connect-button"
        />

        <Text
          style={{
            fontFamily: tokens.font.mono,
            fontSize: 10,
            color: tokens.text.onIronDim,
            letterSpacing: 1,
          }}
        >
          DEVNET · PHASE 1 STUB
        </Text>
      </View>
    </SafeAreaView>
  );
}
