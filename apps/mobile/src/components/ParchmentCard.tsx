import { View } from 'react-native';
import type { ViewProps } from 'react-native';
import { tokens } from '@/theme/tokens';

type Props = ViewProps & {
  /** Optional 4px-wide accent stripe on the left edge. Used by ElderCard. */
  accent?: string;
  children?: React.ReactNode;
};

/**
 * Parchment-faced card. Mirrors the cockpit's MiniCockpit panel chrome:
 * warm aged-paper face, iron-coloured hairline border, optional accent
 * stripe on the left edge. Hand-cut radius (no pillowy edges).
 */
export function ParchmentCard({ accent, children, style, ...rest }: Props) {
  return (
    <View
      {...rest}
      style={[
        {
          backgroundColor: tokens.bg.parchment,
          borderColor: tokens.border.iron,
          borderWidth: 1,
          borderRadius: tokens.radius.md,
          overflow: 'hidden',
          flexDirection: 'row',
          ...tokens.shadow.panel,
        },
        style,
      ]}
    >
      {accent ? (
        <View style={{ width: 4, backgroundColor: accent }} />
      ) : null}
      <View style={{ flex: 1, padding: tokens.space.lg }}>{children}</View>
    </View>
  );
}
