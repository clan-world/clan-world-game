import { useMemo } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { TopBar } from '@/components/TopBar';
import { Parchment } from '@/components/Surfaces';
import { Pill } from '@/components/Pill';
import { ArchetypeGlyph, ARCHETYPE_GLYPHS } from '@/components/ArchetypeGlyph';
import { TickProgress } from '@/components/TickProgress';
import { SectionHeader } from '@/components/SectionHeader';
import { Button } from '@/components/Button';
import { useFollowedClan } from '@/hooks/useFollowedClan';
import { useRecentChainEvents, useSnapshot } from '@/hooks/useSnapshot';
import { findElder } from '@/theme/elders';
import { tokens } from '@/theme/tokens';

const SEASON_LEN = 200;

const RESOURCE_LABEL: Record<string, { label: string; color: string }> = {
  gold: { label: 'GOLD', color: '#D4AF5C' },
  wood: { label: 'WOOD', color: '#8B6B3F' },
  iron: { label: 'IRON', color: '#7A8590' },
  wheat: { label: 'WHEAT', color: '#C7A14F' },
  fish: { label: 'FISH', color: '#5A8AA0' },
  blueprint: { label: 'PLAN', color: '#A89A78' },
};

export default function Hearth() {
  const router = useRouter();
  const snapshot = useSnapshot();
  const events = useRecentChainEvents();
  const { clanId } = useFollowedClan();

  const tick = snapshot?.tick ?? 0;
  const seasonStart = snapshot?.seasonStartTick ?? null;
  const seasonEnd = snapshot?.seasonEndTick ?? null;
  const season = seasonStart !== null ? Math.floor(seasonStart / SEASON_LEN) + 1 : null;
  const seasonPct =
    seasonStart !== null && seasonEnd !== null && seasonEnd > seasonStart
      ? Math.max(0, Math.min(1, (tick - seasonStart) / (seasonEnd - seasonStart)))
      : 0;

  const followedElder = clanId ? findElder(clanId) : null;
  const followedClanData = useMemo(() => {
    if (!snapshot || !followedElder) return null;
    return (
      snapshot.clans.find((c) => Number(c.id) === followedElder.clanId) ?? null
    );
  }, [snapshot, followedElder]);

  const resources = useMemo(() => {
    if (!followedClanData) return null;
    return {
      gold: Number(followedClanData.goldBalance ?? '0'),
      wood: Number(followedClanData.vaultWood ?? '0'),
      iron: Number(followedClanData.vaultIron ?? '0'),
      wheat: Number(followedClanData.vaultWheat ?? '0'),
      fish: Number(followedClanData.vaultFish ?? '0'),
      blueprint: Number(followedClanData.blueprintBalance ?? '0'),
    };
  }, [followedClanData]);

  const recentClanEvents = useMemo(() => {
    if (!events || !followedElder) return [];
    return events
      .filter((e) => e.clanId === followedElder.clanId)
      .slice(0, 3);
  }, [events, followedElder]);

  const totalClans = snapshot?.clans.length ?? 0;
  const livingClansmen = useMemo(() => {
    if (!snapshot) return 0;
    return snapshot.clans.reduce(
      (sum, c) => sum + (c.livingClansmen ?? 0),
      0,
    );
  }, [snapshot]);

  const winterActive = snapshot?.winterActive === true;

  return (
    <View style={{ flex: 1, backgroundColor: tokens.bg.canvas }}>
      <TopBar
        title="HEARTH"
        right={
          <Pressable onPress={() => router.push('/codex')} hitSlop={10}>
            <Text style={{ fontSize: 15, color: tokens.ink.dark }}>⚙</Text>
          </Pressable>
        }
      />
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: 14,
          paddingTop: 12,
          paddingBottom: 24,
          gap: 18,
        }}
      >
        {followedElder && followedClanData && resources ? (
          <Parchment deep style={{ padding: 0 }}>
            {/* Tick + season header */}
            <View style={{ paddingHorizontal: 14, paddingTop: 12, paddingBottom: 10 }}>
              <View
                style={{
                  flexDirection: 'row',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <Text
                  style={{
                    fontFamily: tokens.font.mono,
                    fontSize: 10,
                    color: tokens.ink.parchmentMuted,
                  }}
                >
                  TICK {tick}
                  {season !== null ? ` · SEASON ${season}` : ''}
                </Text>
                <Text
                  style={{
                    fontFamily: tokens.font.mono,
                    fontSize: 10,
                    color: tokens.ink.parchmentMuted,
                  }}
                >
                  {Math.round(seasonPct * 100)}%
                </Text>
              </View>
              <View style={{ height: 8 }} />
              <TickProgress pct={seasonPct} light />
            </View>

            {/* Identity row */}
            <View
              style={{
                paddingHorizontal: 14,
                paddingTop: 14,
                paddingBottom: 12,
                flexDirection: 'row',
                gap: 14,
                alignItems: 'center',
              }}
            >
              <ArchetypeGlyph kind={followedElder.archetype} size={56} />
              <View style={{ flex: 1, gap: 4 }}>
                <Text
                  style={{
                    fontFamily: tokens.font.displaySemi,
                    fontSize: 24,
                    color: tokens.ink.parchment,
                    letterSpacing: 1,
                  }}
                >
                  {followedElder.name}
                </Text>
                <Text
                  style={{
                    fontFamily: tokens.font.script,
                    fontSize: 14,
                    color: tokens.script.blueMuted,
                  }}
                >
                  {ARCHETYPE_GLYPHS[followedElder.archetype].name}
                </Text>
              </View>
              <Pill kind={winterActive ? 'warn' : 'live'}>
                {winterActive ? '⛇ WINTER' : '● LIVE'}
              </Pill>
            </View>

            {/* Resource strip */}
            <View
              style={{
                paddingHorizontal: 14,
                paddingBottom: 12,
                flexDirection: 'row',
                flexWrap: 'wrap',
                gap: 12,
              }}
            >
              {Object.entries(resources).map(([k, v]) => {
                const meta = RESOURCE_LABEL[k];
                return (
                  <View
                    key={k}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 4,
                    }}
                  >
                    <Text style={{ color: meta?.color, fontSize: 14 }}>◇</Text>
                    <Text
                      style={{
                        fontFamily: tokens.font.mono,
                        fontSize: 11,
                        color: tokens.ink.parchment,
                      }}
                    >
                      {String(v)}
                    </Text>
                  </View>
                );
              })}
            </View>

            <View
              style={{
                height: 1,
                backgroundColor: tokens.border.parchmentEdge,
              }}
            />

            {/* Recent movements (chain events filtered to this clan) */}
            <View
              style={{
                paddingHorizontal: 14,
                paddingTop: 10,
                paddingBottom: 12,
              }}
            >
              <Text
                style={{
                  fontFamily: tokens.font.display,
                  fontSize: 9,
                  color: tokens.ink.parchmentMuted,
                  letterSpacing: 1.6,
                  marginBottom: 6,
                }}
              >
                ASSET MOVEMENTS
              </Text>
              {recentClanEvents.length === 0 ? (
                <Text
                  style={{
                    fontFamily: tokens.font.bodyItalic,
                    fontSize: 12,
                    color: tokens.ink.parchmentMuted,
                  }}
                >
                  Silent. Awaiting next tick.
                </Text>
              ) : (
                <View style={{ gap: 6 }}>
                  {recentClanEvents.map((e, i) => (
                    <View
                      key={`${e.txHash}-${e.logIndex ?? i}`}
                      style={{
                        flexDirection: 'row',
                        justifyContent: 'space-between',
                      }}
                    >
                      <Text
                        style={{
                          fontFamily: tokens.font.body,
                          fontSize: 12,
                          color: tokens.ink.parchment,
                          flex: 1,
                        }}
                        numberOfLines={1}
                      >
                        {e.eventName}
                      </Text>
                      <Text
                        style={{
                          fontFamily: tokens.font.mono,
                          fontSize: 10,
                          color: tokens.ink.parchmentMuted,
                          marginLeft: 8,
                        }}
                      >
                        T{e.tick ?? '—'}
                      </Text>
                    </View>
                  ))}
                </View>
              )}
            </View>

            {/* CTA */}
            <View
              style={{
                padding: 12,
                backgroundColor: 'rgba(26, 20, 16, 0.04)',
                borderTopColor: 'rgba(26, 20, 16, 0.15)',
                borderTopWidth: 1,
              }}
            >
              <Button
                label="ENTER COCKPIT  →"
                onPress={() => router.push('/cockpit')}
                variant="primary"
                block
              />
            </View>
          </Parchment>
        ) : (
          <Parchment deep>
            <View style={{ alignItems: 'center', gap: 10, paddingVertical: 6 }}>
              <Text
                style={{
                  fontFamily: tokens.font.script,
                  fontSize: 18,
                  color: tokens.script.blueMuted,
                }}
              >
                Your hall is silent.
              </Text>
              <Text
                style={{
                  fontFamily: tokens.font.body,
                  fontSize: 13,
                  color: tokens.ink.parchment,
                  textAlign: 'center',
                  maxWidth: 240,
                }}
              >
                No Elder claimed yet. Open the Hall and follow one to enter the
                cockpit.
              </Text>
              <View style={{ height: 6 }} />
              <Button
                label="Open The Hall"
                onPress={() => router.push('/(tabs)/hall')}
                variant="primary"
              />
            </View>
          </Parchment>
        )}

        {/* The realm at large */}
        <View style={{ gap: 10 }}>
          <SectionHeader>The Realm</SectionHeader>
          <View
            style={{
              flexDirection: 'row',
              flexWrap: 'wrap',
              gap: 8,
            }}
          >
            <StatCard
              label="TICK"
              value={snapshot ? String(tick) : '—'}
              hint={season !== null ? `Season ${season}` : ''}
            />
            <StatCard
              label="CLANS"
              value={String(totalClans)}
              hint="active in realm"
            />
            <StatCard
              label="CLANSMEN"
              value={String(livingClansmen)}
              hint="alive across all clans"
            />
            <StatCard
              label="STATUS"
              value={winterActive ? 'WINTER' : 'CALM'}
              hint=""
            />
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

function StatCard({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <Parchment
      deep
      style={{
        padding: 12,
        flexBasis: '48%',
        flexGrow: 1,
      }}
    >
      <Text
        style={{
          fontFamily: tokens.font.mono,
          fontSize: 9,
          color: tokens.ink.parchmentMuted,
          letterSpacing: 1,
        }}
      >
        {label}
      </Text>
      <Text
        style={{
          fontFamily: tokens.font.monoMedium,
          fontSize: 22,
          color: tokens.ink.parchment,
          marginTop: 4,
        }}
      >
        {value}
      </Text>
      {hint ? (
        <Text
          style={{
            fontFamily: tokens.font.mono,
            fontSize: 9,
            color: tokens.ink.parchmentFaint,
            marginTop: 2,
          }}
        >
          {hint}
        </Text>
      ) : null}
    </Parchment>
  );
}
