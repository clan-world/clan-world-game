import { useMemo } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { TopBar } from '@/components/TopBar';
import { Parchment, Stone } from '@/components/Surfaces';
import { SectionHeader } from '@/components/SectionHeader';
import { Pill } from '@/components/Pill';
import { Button } from '@/components/Button';
import { ArchetypeGlyph, ARCHETYPE_GLYPHS } from '@/components/ArchetypeGlyph';
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
    <View style={{ flex: 1, backgroundColor: tokens.bg.canvas }}>
      <TopBar title="CODEX" onBack={() => router.back()} />
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: 14,
          paddingTop: 14,
          paddingBottom: 24,
          gap: 16,
        }}
      >
        {/* Wallet identity */}
        <View style={{ gap: 10 }}>
          <SectionHeader>Wallet</SectionHeader>
          <Stone style={{ gap: 10 }}>
            <Row label="Pubkey" value={state.status === 'connected' ? shortPubkey(state.pubkey) : '—'} />
            <Row label="Network" value="devnet" pill="info" />
            <Row label="Adapter" value="MWA" />
          </Stone>
        </View>

        {/* Following */}
        <View style={{ gap: 10 }}>
          <SectionHeader>Following</SectionHeader>
          {followed ? (
            <Parchment deep style={{ padding: 0 }}>
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 12,
                  padding: 12,
                }}
              >
                <ArchetypeGlyph kind={followed.archetype} size={42} />
                <View style={{ flex: 1, gap: 2 }}>
                  <Text
                    style={{
                      fontFamily: tokens.font.displaySemi,
                      fontSize: 17,
                      color: tokens.ink.parchment,
                    }}
                  >
                    {followed.name}
                  </Text>
                  <Text
                    style={{
                      fontFamily: tokens.font.script,
                      fontSize: 12,
                      color: tokens.script.blueMuted,
                    }}
                  >
                    {ARCHETYPE_GLYPHS[followed.archetype].name}
                  </Text>
                </View>
                <Text
                  style={{
                    fontFamily: tokens.font.mono,
                    fontSize: 10,
                    color: tokens.ink.parchmentMuted,
                  }}
                >
                  #{followed.clanId}
                </Text>
              </View>
              <View
                style={{
                  padding: 10,
                  borderTopColor: 'rgba(26,20,16,0.15)',
                  borderTopWidth: 1,
                }}
              >
                <Button
                  label="Unfollow"
                  onPress={() => void unfollow()}
                  variant="secondary"
                  block
                />
              </View>
            </Parchment>
          ) : (
            <Parchment deep>
              <Text
                style={{
                  fontFamily: tokens.font.bodyItalic,
                  fontSize: 13,
                  color: tokens.ink.parchmentMuted,
                  textAlign: 'center',
                }}
              >
                No Elder claimed. Open the Hall to follow one.
              </Text>
            </Parchment>
          )}
        </View>

        {/* Backend */}
        <View style={{ gap: 10 }}>
          <SectionHeader>Backend</SectionHeader>
          <Stone style={{ gap: 10 }}>
            <Row label="Convex host" value={convexHost} mono />
            <Row label="Live updates" value="websocket" />
            <Row label="Cockpit URL" value={cockpitHost()} mono />
          </Stone>
        </View>

        {/* Device */}
        <View style={{ gap: 10 }}>
          <SectionHeader>Device</SectionHeader>
          <Stone>
            <Row
              label="Kind"
              value={deviceLabel(deviceKind)}
              pill={deviceKind === 'seeker' ? 'live' : 'idle'}
            />
          </Stone>
        </View>

        {/* Disconnect */}
        <View style={{ gap: 10 }}>
          <SectionHeader>Session</SectionHeader>
          <Stone>
            <Button
              label="Disconnect Wallet"
              onPress={() => void onDisconnect()}
              variant="secondary"
              block
              testID="disconnect-button"
            />
          </Stone>
        </View>

        <Text
          style={{
            fontFamily: tokens.font.mono,
            fontSize: 9,
            color: tokens.ink.darkFaint,
            textAlign: 'center',
            letterSpacing: 1,
            marginTop: 4,
          }}
        >
          CLAN WORLD MOBILE · 0.1.0 · SLICE 0
        </Text>
      </ScrollView>
    </View>
  );
}

function cockpitHost(): string {
  const url = process.env.EXPO_PUBLIC_COCKPIT_URL ?? '';
  try {
    return new URL(url).hostname;
  } catch {
    return url || '—';
  }
}

type RowProps = {
  label: string;
  value: string;
  mono?: boolean;
  pill?: 'live' | 'warn' | 'danger' | 'info' | 'idle';
};

function Row({ label, value, mono, pill }: RowProps) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingVertical: 4,
      }}
    >
      <Text
        style={{
          fontFamily: tokens.font.body,
          fontSize: 13,
          color: tokens.ink.darkMuted,
        }}
      >
        {label}
      </Text>
      {pill ? (
        <Pill kind={pill}>{value}</Pill>
      ) : (
        <Text
          style={{
            fontFamily: mono ? tokens.font.mono : tokens.font.bodyMedium,
            fontSize: 13,
            color: tokens.ink.dark,
          }}
        >
          {value}
        </Text>
      )}
    </View>
  );
}
