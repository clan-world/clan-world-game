import { Text, View } from 'react-native';
import { tokens } from '@/theme/tokens';

export type PillKind = 'live' | 'warn' | 'danger' | 'info' | 'idle';

const COLORS: Record<PillKind, { bg: string; fg: string; border: string }> = {
  live: {
    bg: 'rgba(107, 142, 92, 0.16)',
    fg: tokens.status.live,
    border: 'rgba(107, 142, 92, 0.4)',
  },
  warn: {
    bg: 'rgba(201, 155, 79, 0.16)',
    fg: tokens.status.warn,
    border: 'rgba(201, 155, 79, 0.4)',
  },
  danger: {
    bg: 'rgba(160, 74, 63, 0.16)',
    fg: tokens.status.danger,
    border: 'rgba(160, 74, 63, 0.4)',
  },
  info: {
    bg: 'rgba(90, 123, 168, 0.16)',
    fg: tokens.status.info,
    border: 'rgba(90, 123, 168, 0.4)',
  },
  idle: {
    bg: 'transparent',
    fg: tokens.ink.darkMuted,
    border: tokens.ink.darkFaint,
  },
};

type Props = {
  kind?: PillKind;
  children: string;
};

/**
 * Mono-font status pill. Background, foreground, and border are all
 * channel-tinted from the same hue so it reads as a calm chip rather than
 * a notification banner.
 */
export function Pill({ kind = 'live', children }: Props) {
  const c = COLORS[kind];
  return (
    <View
      style={{
        backgroundColor: c.bg,
        borderColor: c.border,
        borderWidth: 1,
        borderRadius: tokens.radius.sm,
        paddingHorizontal: 7,
        paddingVertical: 3,
        flexDirection: 'row',
        alignItems: 'center',
        alignSelf: 'flex-start',
      }}
    >
      <Text
        style={{
          fontFamily: tokens.font.mono,
          fontSize: 10,
          color: c.fg,
          letterSpacing: 0.4,
        }}
      >
        {children}
      </Text>
    </View>
  );
}
