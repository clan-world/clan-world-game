import { Pressable, Text, View } from 'react-native';
import { tokens } from '@/theme/tokens';

type Props = {
  children: string;
  /** Optional right-side ghost-button label, e.g. "View all →". */
  action?: string;
  onAction?: () => void;
  /** Use parchment-friendly text colours (for sections inside a parchment card). */
  light?: boolean;
};

/**
 * Cinzel uppercase section heading + a thin gold rule beneath. Optionally
 * paired with a right-aligned italic action label that triggers a callback.
 */
export function SectionHeader({ children, action, onAction, light }: Props) {
  return (
    <View style={{ gap: 6 }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <Text
          style={{
            fontFamily: tokens.font.display,
            fontSize: 11,
            color: light ? tokens.ink.parchmentMuted : tokens.ink.dark,
            letterSpacing: 1.8,
            textTransform: 'uppercase',
          }}
        >
          {children}
        </Text>
        {action ? (
          <Pressable onPress={onAction}>
            <Text
              style={{
                fontFamily: tokens.font.script,
                fontSize: 13,
                color: tokens.gold.primary,
              }}
            >
              {action}
            </Text>
          </Pressable>
        ) : null}
      </View>
      <View
        style={{
          height: 1,
          backgroundColor: tokens.gold.primary,
          opacity: light ? 0.55 : 0.7,
        }}
      />
    </View>
  );
}
