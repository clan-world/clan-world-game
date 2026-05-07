import { useMemo } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { TopBar } from '@/components/TopBar';
import { Parchment } from '@/components/Surfaces';
import { SectionHeader } from '@/components/SectionHeader';
import { Pill } from '@/components/Pill';
import { ELDERS, findElder } from '@/theme/elders';
import { ARCHETYPE_GLYPHS } from '@/components/ArchetypeGlyph';
import { useSnapshot } from '@/hooks/useSnapshot';
import { tokens } from '@/theme/tokens';

const RESOURCE_KEYS = ['gold', 'wood', 'iron', 'wheat', 'fish', 'blueprint'] as const;
type ResourceKey = (typeof RESOURCE_KEYS)[number];

const RESOURCE_LABEL: Record<ResourceKey, string> = {
  gold: 'GOLD',
  wood: 'WOOD',
  iron: 'IRON',
  wheat: 'WHEAT',
  fish: 'FISH',
  blueprint: 'PLAN',
};

/**
 * Bazaar — the design's iNFT marketplace listings aren't backed by Convex
 * data yet (no on-chain marketplace contract). Instead we surface what IS
 * real: each Elder's current vault holdings side-by-side, so a user can
 * spot relative wealth and resource pressure across the realm.
 *
 * When the iNFT marketplace lands in a future slice, this screen swaps for
 * the design's hireable-iNFT list.
 */
export default function Bazaar() {
  const snapshot = useSnapshot();

  const clansByResource = useMemo(() => {
    if (!snapshot) return null;
    const out: Record<ResourceKey, Array<{ clanId: number; value: number }>> = {
      gold: [],
      wood: [],
      iron: [],
      wheat: [],
      fish: [],
      blueprint: [],
    };
    for (const clan of snapshot.clans) {
      const id = Number(clan.id);
      out.gold.push({ clanId: id, value: Number(clan.goldBalance ?? '0') });
      out.wood.push({ clanId: id, value: Number(clan.vaultWood ?? '0') });
      out.iron.push({ clanId: id, value: Number(clan.vaultIron ?? '0') });
      out.wheat.push({ clanId: id, value: Number(clan.vaultWheat ?? '0') });
      out.fish.push({ clanId: id, value: Number(clan.vaultFish ?? '0') });
      out.blueprint.push({
        clanId: id,
        value: Number(clan.blueprintBalance ?? '0'),
      });
    }
    return out;
  }, [snapshot]);

  return (
    <View style={{ flex: 1, backgroundColor: tokens.bg.canvas }}>
      <TopBar
        title="THE BAZAAR"
        sub="markets · clan vaults"
        right={<Pill kind="info">PREVIEW</Pill>}
      />
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: 14,
          paddingTop: 12,
          paddingBottom: 24,
          gap: 16,
        }}
      >
        <Text
          style={{
            fontFamily: tokens.font.bodyItalic,
            fontSize: 12,
            color: tokens.ink.darkMuted,
            paddingHorizontal: 4,
            lineHeight: 18,
          }}
        >
          The realm's tradesmen are still being assembled. Until the marketplace
          opens, here is what each Elder has on hand — wealth, grain, the
          tools of war.
        </Text>

        {clansByResource ? (
          RESOURCE_KEYS.map((key) => (
            <View key={key} style={{ gap: 10 }}>
              <SectionHeader>{RESOURCE_LABEL[key]}</SectionHeader>
              <Parchment deep style={{ padding: 0 }}>
                {clansByResource[key]
                  .sort((a, b) => b.value - a.value)
                  .map((row, idx, arr) => {
                    const elder = findElder(row.clanId);
                    const archetype = elder
                      ? ARCHETYPE_GLYPHS[elder.archetype]
                      : null;
                    return (
                      <View
                        key={row.clanId}
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          gap: 12,
                          paddingHorizontal: 12,
                          paddingVertical: 10,
                          borderBottomWidth: idx === arr.length - 1 ? 0 : 1,
                          borderBottomColor: 'rgba(26,20,16,0.12)',
                        }}
                      >
                        <Text
                          style={{
                            fontFamily: tokens.font.displaySemi,
                            fontSize: 18,
                            color: archetype?.color ?? tokens.ink.parchment,
                            width: 22,
                          }}
                        >
                          {archetype?.mark ?? '◇'}
                        </Text>
                        <Text
                          style={{
                            fontFamily: tokens.font.body,
                            fontSize: 13,
                            color: tokens.ink.parchment,
                            flex: 1,
                          }}
                        >
                          {elder?.name ?? `Clan ${row.clanId}`}
                        </Text>
                        <Text
                          style={{
                            fontFamily: tokens.font.monoMedium,
                            fontSize: 13,
                            color: tokens.ink.parchment,
                          }}
                        >
                          {row.value}
                        </Text>
                      </View>
                    );
                  })}
              </Parchment>
            </View>
          ))
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
              Listening for the realm…
            </Text>
          </Parchment>
        )}

        {/* Roster footer to remind which mark belongs to whom */}
        <View style={{ gap: 10 }}>
          <SectionHeader>Roster</SectionHeader>
          <Parchment deep style={{ padding: 12, gap: 8 }}>
            {ELDERS.map((elder) => {
              const m = ARCHETYPE_GLYPHS[elder.archetype];
              return (
                <View
                  key={elder.clanId}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 10,
                  }}
                >
                  <Text
                    style={{
                      fontFamily: tokens.font.displaySemi,
                      fontSize: 16,
                      color: m.color,
                      width: 22,
                    }}
                  >
                    {m.mark}
                  </Text>
                  <Text
                    style={{
                      fontFamily: tokens.font.bodyMedium,
                      fontSize: 13,
                      color: tokens.ink.parchment,
                      flex: 1,
                    }}
                  >
                    {elder.name}
                  </Text>
                  <Text
                    style={{
                      fontFamily: tokens.font.script,
                      fontSize: 12,
                      color: tokens.script.blueMuted,
                    }}
                  >
                    {m.name}
                  </Text>
                </View>
              );
            })}
          </Parchment>
        </View>
      </ScrollView>
    </View>
  );
}
