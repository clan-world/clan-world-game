import { Redirect } from 'expo-router';
import { Text, View } from 'react-native';
import { useWallet } from '@/hooks/useWallet';
import { tokens } from '@/theme/tokens';

/**
 * Entry route. Routes to /(tabs)/hearth if a stored MWA session reauthorized
 * silently on cold launch; otherwise lands on /connect. While the cold-launch
 * reauthorize is in flight, render a void background (matches splash) so the
 * transition is invisible.
 */
export default function Index() {
  const { state, hydrating } = useWallet();

  if (hydrating) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: tokens.bg.void,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Text
          style={{
            fontFamily: tokens.font.mono,
            fontSize: 10,
            color: tokens.text.onIronDim,
            letterSpacing: 1,
          }}
        >
          ◈
        </Text>
      </View>
    );
  }

  return state.status === 'connected'
    ? <Redirect href="/(tabs)/hearth" />
    : <Redirect href="/connect" />;
}
