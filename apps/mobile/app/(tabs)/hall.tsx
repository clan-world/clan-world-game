import { useMemo } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { TopBar } from '@/components/TopBar';
import { Parchment } from '@/components/Surfaces';
import { ArchetypeGlyph, ARCHETYPE_GLYPHS } from '@/components/ArchetypeGlyph';
import { Pill } from '@/components/Pill';
import { useFollowedClan } from '@/hooks/useFollowedClan';
import { useInftDemoState, useSnapshot } from '@/hooks/useSnapshot';
import { ELDERS } from '@/theme/elders';
import type { ElderDef } from '@/theme/elders';
import { tokens } from '@/theme/tokens';

function shortAddr(addr?: string | null): string {
  if (!addr) return '—';
  if (addr.length < 12) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function shortHash(hash?: string | null): string {
  if (!hash) return '—';
  if (hash.length < 14) return hash;
  return `${hash.slice(0, 10)}…`;
}

export default function Hall() {
  return (
    <View style={{ flex: 1, backgroundColor: tokens.bg.canvas }}>
      <TopBar title="MY HALL" sub="four elders · all yours" />
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: 14,
          paddingTop: 12,
          paddingBottom: 24,
          gap: 10,
        }}
      >
        {ELDERS.map((elder) => (
          <ElderCard key={elder.clanId} elder={elder} />
        ))}
      </ScrollView>
    </View>
  );
}

function ElderCard({ elder }: { elder: ElderDef }) {
  const inft = useInftDemoState(elder.clanId);
  const snapshot = useSnapshot();
  const { clanId: followed, follow } = useFollowedClan();

  const isFollowed = followed === elder.clanId;
  const archetypeMeta = ARCHETYPE_GLYPHS[elder.archetype];

  const clanData = useMemo(() => {
    if (!snapshot) return null;
    return snapshot.clans.find((c) => Number(c.id) === elder.clanId) ?? null;
  }, [snapshot, elder.clanId]);

  const isLive = (clanData?.livingClansmen ?? 0) > 0;
  const tick = snapshot?.tick ?? 0;

  return (
    <Parchment deep style={{ padding: 0 }}>
      <View
        style={{
          flexDirection: 'row',
          gap: 12,
          padding: 12,
          alignItems: 'flex-start',
        }}
      >
        <View style={{ width: 56, paddingTop: 4 }}>
          <ArchetypeGlyph kind={elder.archetype} size={48} />
        </View>
        <View style={{ flex: 1, gap: 4 }}>
          <Text
            style={{
              fontFamily: tokens.font.displaySemi,
              fontSize: 18,
              color: tokens.ink.parchment,
            }}
          >
            {elder.name}
          </Text>
          <Text
            style={{
              fontFamily: tokens.font.script,
              fontSize: 13,
              color: tokens.script.blueMuted,
            }}
          >
            {archetypeMeta.name}
          </Text>
          <Text
            style={{
              fontFamily: tokens.font.mono,
              fontSize: 9,
              color: tokens.ink.parchmentMuted,
              marginTop: 2,
            }}
          >
            {inft?.token?.tokenId !== undefined
              ? `#${inft.token.tokenId} · ${shortAddr(inft.token?.owner)}`
              : 'unminted'}
          </Text>
        </View>
        <View style={{ alignItems: 'flex-end', gap: 4 }}>
          <StatPill label="BASE" value={`L${clanData?.baseLevel ?? 0}`} />
          <StatPill label="WALL" value={`L${clanData?.wallLevel ?? 0}`} />
          <StatPill label="MEN" value={String(clanData?.livingClansmen ?? 0)} />
        </View>
      </View>

      {/* Hash row */}
      <View
        style={{
          paddingHorizontal: 12,
          paddingBottom: 10,
        }}
      >
        <Text
          style={{
            fontFamily: tokens.font.mono,
            fontSize: 9,
            color: tokens.ink.parchmentFaint,
          }}
        >
          DATA · {shortHash(inft?.token?.dataHash)}
        </Text>
      </View>

      {/* Status row */}
      <View
        style={{
          paddingHorizontal: 12,
          paddingVertical: 6,
          borderTopColor: 'rgba(26,20,16,0.18)',
          borderTopWidth: 1,
          backgroundColor: 'rgba(26,20,16,0.06)',
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
        }}
      >
        <Text
          style={{
            fontFamily: tokens.font.mono,
            fontSize: 10,
            color: isLive ? tokens.status.live : tokens.ink.parchmentMuted,
            letterSpacing: 1.2,
          }}
        >
          {isLive ? `● IN GAME · TICK ${tick}` : '○ IDLE'}
        </Text>

        <Pressable
          onPress={() => void follow(elder.clanId)}
          disabled={isFollowed}
          hitSlop={6}
        >
          {isFollowed ? (
            <Pill kind="live">FOLLOWING</Pill>
          ) : (
            <View
              style={{
                paddingHorizontal: 10,
                paddingVertical: 3,
                borderColor: tokens.gold.deep,
                borderWidth: 1,
                borderRadius: tokens.radius.sm,
              }}
            >
              <Text
                style={{
                  fontFamily: tokens.font.display,
                  fontSize: 9,
                  color: tokens.gold.deep,
                  letterSpacing: 1.4,
                }}
              >
                FOLLOW
              </Text>
            </View>
          )}
        </Pressable>
      </View>
    </Parchment>
  );
}

function StatPill({ label, value }: { label: string; value: string }) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        backgroundColor: 'rgba(26,20,16,0.08)',
        borderColor: 'rgba(26,20,16,0.18)',
        borderWidth: 1,
        borderRadius: tokens.radius.sm,
        paddingHorizontal: 6,
        paddingVertical: 3,
        minWidth: 70,
        gap: 6,
      }}
    >
      <Text
        style={{
          fontFamily: tokens.font.mono,
          fontSize: 8,
          color: tokens.ink.parchmentMuted,
          letterSpacing: 1,
        }}
      >
        {label}
      </Text>
      <Text
        style={{
          fontFamily: tokens.font.monoMedium,
          fontSize: 10,
          color: tokens.ink.parchment,
        }}
      >
        {value}
      </Text>
    </View>
  );
}
