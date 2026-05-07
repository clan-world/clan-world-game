import { Pressable, Text, View } from 'react-native';
import { ParchmentCard } from './ParchmentCard';
import { useInftDemoState } from '@/hooks/useSnapshot';
import { useFollowedClan } from '@/hooks/useFollowedClan';
import type { ElderDef } from '@/theme/elders';
import { tokens } from '@/theme/tokens';

type Props = {
  elder: ElderDef;
};

function shortAddr(addr: string | undefined): string {
  if (!addr) return '—';
  if (addr.length < 12) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function shortHash(hash: string | undefined): string {
  if (!hash) return '—';
  if (hash.length < 12) return hash;
  return `${hash.slice(0, 8)}…`;
}

export function ElderCard({ elder }: Props) {
  const data = useInftDemoState(elder.clanId);
  const { clanId: followed, follow } = useFollowedClan();
  const isFollowed = followed === elder.clanId;
  const token = data?.token ?? null;
  const isLoading = data === undefined;

  return (
    <ParchmentCard accent={elder.accent}>
      {/* Header — glyph + name + archetype */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: tokens.space.md }}>
        <View
          style={{
            width: 44,
            height: 44,
            backgroundColor: tokens.bg.parchmentDim,
            borderColor: tokens.border.parchmentEdge,
            borderWidth: 1,
            borderRadius: tokens.radius.md,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text
            style={{
              fontFamily: tokens.font.displayBold,
              fontSize: 22,
              color: elder.accent,
            }}
          >
            {elder.glyph}
          </Text>
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text
            style={{
              fontFamily: tokens.font.displayBold,
              fontSize: 16,
              color: tokens.text.onParchment,
              letterSpacing: 1.5,
              textTransform: 'uppercase',
            }}
          >
            {elder.name}
          </Text>
          <Text
            style={{
              fontFamily: tokens.font.body,
              fontSize: 11,
              color: tokens.text.onParchmentDim,
              fontStyle: 'italic',
            }}
          >
            {elder.archetype}
          </Text>
        </View>
        <Text
          style={{
            fontFamily: tokens.font.mono,
            fontSize: 10,
            color: tokens.text.muted,
            letterSpacing: 1,
          }}
        >
          #{elder.clanId}
        </Text>
      </View>

      <View style={{ height: tokens.space.md }} />

      {/* iNFT metadata rows */}
      <View style={{ gap: tokens.space.xs }}>
        <DetailRow
          label="Token"
          value={isLoading ? '…' : token ? `#${token.tokenId}` : 'unminted'}
        />
        <DetailRow
          label="Owner"
          value={isLoading ? '…' : shortAddr(token?.owner)}
        />
        <DetailRow
          label="Data hash"
          value={isLoading ? '…' : shortHash(token?.dataHash)}
        />
      </View>

      <View style={{ height: tokens.space.md }} />

      {/* Follow toggle */}
      <Pressable
        onPress={() => void follow(elder.clanId)}
        disabled={isFollowed}
        testID={`follow-${elder.clanId}`}
        style={({ pressed }) => ({
          opacity: pressed ? 0.85 : 1,
        })}
      >
        <View
          style={{
            backgroundColor: isFollowed ? tokens.text.accent : 'transparent',
            borderColor: isFollowed ? tokens.text.accent : tokens.border.iron,
            borderWidth: 1,
            borderRadius: tokens.radius.sm,
            paddingVertical: tokens.space.sm,
            alignItems: 'center',
          }}
        >
          <Text
            style={{
              fontFamily: tokens.font.displayBold,
              fontSize: 11,
              letterSpacing: 2,
              textTransform: 'uppercase',
              color: isFollowed ? tokens.bg.ironDeep : tokens.text.onParchment,
            }}
          >
            {isFollowed ? 'Following' : 'Follow'}
          </Text>
        </View>
      </Pressable>
    </ParchmentCard>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <View
      style={{
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'baseline',
      }}
    >
      <Text
        style={{
          fontFamily: tokens.font.body,
          fontSize: 11,
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
