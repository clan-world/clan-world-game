import { useMemo } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ParchmentCard } from '@/components/ParchmentCard';
import { useWallet } from '@/hooks/useWallet';
import { useFollowedClan } from '@/hooks/useFollowedClan';
import { detectDeviceKind } from '@/lib/device-detect';
import { deviceLabel } from '@/lib/device';
import { findElder } from '@/theme/elders';
import { tokens } from '@/theme/tokens';

function shortPubkey(pubkey: string): string {
  if (pubkey.length < 12) return pubkey;
  return `${pubkey.slice(0, 6)}…${pubkey.slice(-6)}`;
}

export default function Codex() {
  const router = useRouter();
  const { state, disconnect } = useWallet();
  const { clanId, unfollow } = useFollowedClan();

  const deviceKind = useMemo(() => detectDeviceKind(), []);
  const followed = clanId ? findElder(clanId) : null;
  const convexHost = useMemo(() => {
    const url = process.env.EXPO_PUBLIC_CONVEX_URL ?? '';
    try {
      return new URL(url).hostname;
    } catch {
      return url || '—';
    }
  }, []);

  const onDisconnect = async () => {
    await disconnect();
    router.replace('/connect');
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: tokens.bg.void }}>
      <ScrollView
        contentContainerStyle={{
          padding: tokens.space.lg,
          gap: tokens.space.md,
        }}
      >
        <Text
          style={{
            fontFamily: tokens.font.display,
            fontSize: 11,
            color: tokens.text.onIronDim,
            letterSpacing: 2,
            textTransform: 'uppercase',
            marginBottom: tokens.space.xs,
          }}
        >
          Codex
        </Text>

        <ParchmentCard>
          <SectionHeader>Wallet</SectionHeader>
          <DetailRow
            label="Pubkey"
            value={
              state.status === 'connected' ? shortPubkey(state.pubkey) : '—'
            }
          />
          <DetailRow label="Network" value="devnet" />
          <DetailRow label="Adapter" value="MWA" />
        </ParchmentCard>

        <ParchmentCard>
          <SectionHeader>Following</SectionHeader>
          {followed ? (
            <>
              <DetailRow label="Clan" value={`#${followed.clanId}`} />
              <DetailRow label="Name" value={followed.name} />
              <DetailRow label="Archetype" value={followed.archetype} />
              <View style={{ height: tokens.space.sm }} />
              <Pressable onPress={() => void unfollow()}>
                <View
                  style={{
                    borderColor: tokens.border.iron,
                    borderWidth: 1,
                    borderRadius: tokens.radius.sm,
                    paddingVertical: tokens.space.sm,
                    alignItems: 'center',
                  }}
                >
                  <Text
                    style={{
                      fontFamily: tokens.font.displayBold,
                      fontSize: 10,
                      color: tokens.text.onParchment,
                      letterSpacing: 2,
                      textTransform: 'uppercase',
                    }}
                  >
                    Unfollow
                  </Text>
                </View>
              </Pressable>
            </>
          ) : (
            <Text
              style={{
                fontFamily: tokens.font.body,
                fontSize: 12,
                color: tokens.text.onParchmentDim,
                fontStyle: 'italic',
              }}
            >
              No clan claimed. Open the Hall to follow one.
            </Text>
          )}
        </ParchmentCard>

        <ParchmentCard>
          <SectionHeader>Backend</SectionHeader>
          <DetailRow label="Convex host" value={convexHost} />
          <DetailRow label="Live updates" value="websocket" />
        </ParchmentCard>

        <ParchmentCard>
          <SectionHeader>Device</SectionHeader>
          <DetailRow label="Kind" value={deviceLabel(deviceKind)} />
        </ParchmentCard>

        <View style={{ height: tokens.space.md }} />

        <Pressable onPress={() => void onDisconnect()} testID="disconnect-button">
          <View
            style={{
              borderColor: tokens.text.danger,
              borderWidth: 1,
              borderRadius: tokens.radius.md,
              paddingVertical: tokens.space.md,
              alignItems: 'center',
              backgroundColor: 'transparent',
            }}
          >
            <Text
              style={{
                fontFamily: tokens.font.displayBold,
                fontSize: 12,
                color: tokens.text.danger,
                letterSpacing: 2,
                textTransform: 'uppercase',
              }}
            >
              Disconnect Wallet
            </Text>
          </View>
        </Pressable>

        <Text
          style={{
            fontFamily: tokens.font.mono,
            fontSize: 10,
            color: tokens.text.onIronDim,
            textAlign: 'center',
            letterSpacing: 1,
            marginTop: tokens.space.lg,
          }}
        >
          CLAN WORLD MOBILE · 0.1.0 · SLICE 0
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function SectionHeader({ children }: { children: string }) {
  return (
    <Text
      style={{
        fontFamily: tokens.font.displayBold,
        fontSize: 12,
        color: tokens.text.onParchment,
        letterSpacing: 2,
        textTransform: 'uppercase',
        marginBottom: tokens.space.xs,
      }}
    >
      {children}
    </Text>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'baseline',
        justifyContent: 'space-between',
        paddingVertical: 2,
      }}
    >
      <Text
        style={{
          fontFamily: tokens.font.body,
          fontSize: 12,
          color: tokens.text.onParchmentDim,
          letterSpacing: 0.5,
        }}
      >
        {label}
      </Text>
      <Text
        style={{
          fontFamily: tokens.font.mono,
          fontSize: 12,
          color: tokens.text.onParchment,
          letterSpacing: 0.5,
        }}
      >
        {value}
      </Text>
    </View>
  );
}
