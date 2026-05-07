import { useMemo } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { TopBar } from '@/components/TopBar';
import { Parchment, Stone } from '@/components/Surfaces';
import { SectionHeader } from '@/components/SectionHeader';
import { Pill } from '@/components/Pill';
import { Button } from '@/components/Button';
import { ArchetypeGlyph } from '@/components/ArchetypeGlyph';
import { useWallet } from '@/hooks/useWallet';
import { useFollowedClan } from '@/hooks/useFollowedClan';
import { useSnapshot } from '@/hooks/useSnapshot';
import { findElder } from '@/theme/elders';
import { tokens } from '@/theme/tokens';

function shortPubkey(pk: string): string {
  if (pk.length < 10) return pk;
  return `${pk.slice(0, 4)}…${pk.slice(-4)}`;
}

export default function Treasury() {
  const { state } = useWallet();
  const { clanId } = useFollowedClan();
  const snapshot = useSnapshot();

  const followedElder = clanId ? findElder(clanId) : null;
  const followedClanData = useMemo(() => {
    if (!snapshot || !followedElder) return null;
    return (
      snapshot.clans.find((c) => Number(c.id) === followedElder.clanId) ?? null
    );
  }, [snapshot, followedElder]);

  const onChainGold = followedClanData?.goldBalance ?? '0';

  return (
    <View style={{ flex: 1, backgroundColor: tokens.bg.canvas }}>
      <TopBar title="TREASURY" sub="solana · base · 0g" />
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: 14,
          paddingTop: 12,
          paddingBottom: 24,
          gap: 16,
        }}
      >
        {/* Wallet ownership card */}
        <Stone style={{ padding: 0 }}>
          <View
            style={{
              padding: 16,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <View style={{ gap: 4 }}>
              <Text
                style={{
                  fontFamily: tokens.font.display,
                  fontSize: 10,
                  color: tokens.ink.darkMuted,
                  letterSpacing: 1.4,
                }}
              >
                YOUR PUBKEY
              </Text>
              <Text
                style={{
                  fontFamily: tokens.font.monoMedium,
                  fontSize: 16,
                  color: tokens.ink.dark,
                }}
              >
                {state.status === 'connected' ? shortPubkey(state.pubkey) : '—'}
              </Text>
            </View>
            <Pill kind="info">DEVNET</Pill>
          </View>
        </Stone>

        {/* On-chain GOLD (the followed clan's balance) */}
        <View style={{ gap: 10 }}>
          <SectionHeader>On-chain GOLD</SectionHeader>
          {followedElder && followedClanData ? (
            <Parchment deep style={{ padding: 0 }}>
              <View
                style={{
                  padding: 14,
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 14,
                }}
              >
                <ArchetypeGlyph kind={followedElder.archetype} size={48} />
                <View style={{ flex: 1, gap: 2 }}>
                  <Text
                    style={{
                      fontFamily: tokens.font.displaySemi,
                      fontSize: 18,
                      color: tokens.ink.parchment,
                    }}
                  >
                    {followedElder.name}
                  </Text>
                  <Text
                    style={{
                      fontFamily: tokens.font.script,
                      fontSize: 12,
                      color: tokens.script.blueMuted,
                    }}
                  >
                    Treasury
                  </Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text
                    style={{
                      fontFamily: tokens.font.monoMedium,
                      fontSize: 22,
                      color: tokens.ink.parchment,
                    }}
                  >
                    {onChainGold}
                  </Text>
                  <Text
                    style={{
                      fontFamily: tokens.font.mono,
                      fontSize: 9,
                      color: tokens.gold.deep,
                      letterSpacing: 1,
                    }}
                  >
                    GOLD · BASE
                  </Text>
                </View>
              </View>
              <View
                style={{
                  padding: 12,
                  borderTopColor: 'rgba(26,20,16,0.15)',
                  borderTopWidth: 1,
                  backgroundColor: 'rgba(26,20,16,0.04)',
                }}
              >
                <Text
                  style={{
                    fontFamily: tokens.font.bodyItalic,
                    fontSize: 11,
                    color: tokens.ink.parchmentMuted,
                  }}
                >
                  Mirrored from the Base Sepolia ledger via Convex.
                </Text>
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
                Follow an Elder in the Hall to see their GOLD here.
              </Text>
            </Parchment>
          )}
        </View>

        {/* Bridge from Solana — placeholder */}
        <View style={{ gap: 10 }}>
          <SectionHeader>Bridge from Solana</SectionHeader>
          <Stone style={{ padding: 14, gap: 8 }}>
            <Text
              style={{
                fontFamily: tokens.font.body,
                fontSize: 13,
                color: tokens.ink.dark,
                lineHeight: 18,
              }}
            >
              The Wormhole NTT bridge from Solana to Base Sepolia is being
              wired up in <Text style={{ fontFamily: tokens.font.mono, fontSize: 12 }}>gold-bridge-monorepo</Text>.
              When it ships, you'll be able to lock SOL-side GOLD here and
              mint Base-side GOLD into your followed clan's treasury.
            </Text>
            <View style={{ height: 6 }} />
            <Button
              label="Bridge — coming soon"
              onPress={() => {}}
              variant="secondary"
              disabled
              block
            />
          </Stone>
        </View>

        {/* Recent activity — placeholder */}
        <View style={{ gap: 10 }}>
          <SectionHeader>Recent Activity</SectionHeader>
          <Parchment deep>
            <Text
              style={{
                fontFamily: tokens.font.bodyItalic,
                fontSize: 13,
                color: tokens.ink.parchmentMuted,
                textAlign: 'center',
              }}
            >
              No transactions yet. Bridged transfers will appear here once the
              cross-chain pipe is live.
            </Text>
          </Parchment>
        </View>
      </ScrollView>
    </View>
  );
}
