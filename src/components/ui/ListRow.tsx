import React from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { colors, radii, spacing } from '../../theme';
import { Icon, type IconName } from './Icon';
import { T } from './Text';

export interface ListRowProps {
  title: string;
  subtitle?: string;
  leading?: React.ReactNode;
  icon?: IconName;
  iconTone?: 'saffron' | 'success' | 'warning' | 'danger' | 'info' | 'ink' | 'neutral';
  trailing?: React.ReactNode;
  chevron?: boolean;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
  last?: boolean;
}

const iconBg = {
  saffron: { bg: colors.saffronSoft, fg: colors.saffronDeep },
  success: { bg: colors.successSoft, fg: colors.success },
  warning: { bg: colors.warningSoft, fg: colors.warning },
  danger: { bg: colors.dangerSoft, fg: colors.danger },
  info: { bg: colors.infoSoft, fg: colors.info },
  ink: { bg: colors.ink, fg: colors.onDark },
  neutral: { bg: colors.parchmentDeep, fg: colors.inkSoft },
};

export function ListRow({ title, subtitle, leading, icon, iconTone = 'saffron', trailing, chevron, onPress, style, last }: ListRowProps) {
  const c = iconBg[iconTone];
  const inner = (
    <View style={[styles.row, !last && styles.divider, style]}>
      {leading ?? (icon ? (
        <View style={[styles.iconWrap, { backgroundColor: c.bg }]}>
          <Icon name={icon} size={20} color={c.fg} />
        </View>
      ) : null)}
      <View style={{ flex: 1, gap: 2 }}>
        <T variant="bodyStrong" numberOfLines={1}>
          {title}
        </T>
        {subtitle ? (
          <T variant="caption" numberOfLines={2}>
            {subtitle}
          </T>
        ) : null}
      </View>
      {trailing}
      {chevron ? <Icon name="chevron-forward" size={18} color={colors.faint} /> : null}
    </View>
  );
  if (!onPress) return inner;
  return <Pressable onPress={onPress} style={({ pressed }) => pressed && { backgroundColor: colors.cardAlt }}>{inner}</Pressable>;
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md },
  divider: { borderBottomWidth: 1, borderBottomColor: colors.hairline },
  iconWrap: { width: 42, height: 42, borderRadius: radii.md, alignItems: 'center', justifyContent: 'center' },
});
