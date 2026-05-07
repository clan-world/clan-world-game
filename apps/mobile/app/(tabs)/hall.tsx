import { ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ElderCard } from '@/components/ElderCard';
import { ELDERS } from '@/theme/elders';
import { tokens } from '@/theme/tokens';

export default function Hall() {
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: tokens.bg.void }}>
      <ScrollView
        contentContainerStyle={{
          padding: tokens.space.lg,
          gap: tokens.space.md,
        }}
      >
        <View style={{ gap: tokens.space.xs, marginBottom: tokens.space.sm }}>
          <Text
            style={{
              fontFamily: tokens.font.display,
              fontSize: 11,
              color: tokens.text.onIronDim,
              letterSpacing: 2,
              textTransform: 'uppercase',
            }}
          >
            The Hall
          </Text>
          <Text
            style={{
              fontFamily: tokens.font.body,
              fontSize: 12,
              color: tokens.text.onIronDim,
            }}
          >
            Four Elders. Tap Follow to claim one as yours; the Cockpit will load that clan.
          </Text>
        </View>

        {ELDERS.map((elder) => (
          <ElderCard key={elder.clanId} elder={elder} />
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}
