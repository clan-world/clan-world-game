import { Text, View } from 'react-native';
import Svg, { Polygon } from 'react-native-svg';
import { tokens } from '@/theme/tokens';
import type { ArchetypeKind } from '@/theme/elders';

export type ArchetypeMeta = {
  mark: string;
  color: string;
  name: string;
  short: string;
};

/**
 * Catalog of the design's six archetypes — one rune per kind, each with a
 * tinted colour and a one-line description used on Hall cards and the
 * Codex screen.
 */
export const ARCHETYPE_GLYPHS: Record<ArchetypeKind, ArchetypeMeta> = {
  'patient-builder': {
    mark: '⏃',
    color: '#A89A78',
    name: 'Patient Builder',
    short: 'A slow, deep accumulator. Trades wood for time.',
  },
  warlord: {
    mark: '⚔',
    color: '#A04A3F',
    name: 'Warlord',
    short: 'Strikes early. Begins enemies, not friendships.',
  },
  diplomat: {
    mark: '✺',
    color: '#5A7BA8',
    name: 'Diplomat',
    short: 'Seeks pacts. A treaty is a tool.',
  },
  hermit: {
    mark: '☖',
    color: '#8C6F3A',
    name: 'Hermit',
    short: 'Builds inward. Speaks rarely. Remembers all.',
  },
  trickster: {
    mark: '✦',
    color: '#9B6FA0',
    name: 'Trickster',
    short: 'Lies plausibly. Keeps a second ledger.',
  },
  'verdant-warden': {
    mark: '✧',
    color: '#6B8E5C',
    name: 'Verdant Warden',
    short: 'Husbands grain. Fights only at the wall.',
  },
};

type Props = {
  kind: ArchetypeKind;
  size?: number;
  framed?: boolean;
};

/**
 * Diamond-framed runic mark — the design's signature iNFT identity glyph.
 * Two concentric diamonds drawn via SVG, the rune in display font centered
 * inside.
 */
export function ArchetypeGlyph({ kind, size = 56, framed = true }: Props) {
  const a = ARCHETYPE_GLYPHS[kind] ?? ARCHETYPE_GLYPHS['patient-builder'];
  return (
    <View
      style={{
        width: size,
        height: size,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {framed ? (
        <Svg
          width={size}
          height={size}
          viewBox="0 0 100 100"
          style={{ position: 'absolute' }}
        >
          <Polygon
            points="50,4 96,50 50,96 4,50"
            fill="none"
            stroke={tokens.gold.deep}
            strokeWidth="1.5"
            opacity={0.7}
          />
          <Polygon
            points="50,12 88,50 50,88 12,50"
            fill="none"
            stroke={tokens.gold.primary}
            strokeWidth="0.8"
            opacity={0.5}
          />
        </Svg>
      ) : null}
      <Text
        style={{
          fontFamily: tokens.font.displaySemi,
          fontSize: size * 0.42,
          color: a.color,
        }}
      >
        {a.mark}
      </Text>
    </View>
  );
}
