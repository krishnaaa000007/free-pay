import React from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import type { TxnStatus } from '../../domain/types';
import { useI18n } from '../../providers/I18nProvider';
import { colors, radii, spacing, statusColor } from '../../theme';
import { Icon, type IconName } from './Icon';
import { T } from './Text';

export type PillTone = 'neutral' | 'saffron' | 'success' | 'warning' | 'danger' | 'info' | 'ink' | 'gold';

const tones: Record<PillTone, { bg: string; fg: string }> = {
  neutral: { bg: colors.parchmentDeep, fg: colors.inkSoft },
  saffron: { bg: colors.saffronSoft, fg: colors.saffronDeep },
  success: { bg: colors.successSoft, fg: colors.success },
  warning: { bg: colors.warningSoft, fg: colors.warning },
  danger: { bg: colors.dangerSoft, fg: colors.danger },
  info: { bg: colors.infoSoft, fg: colors.info },
  ink: { bg: colors.ink, fg: colors.onDark },
  gold: { bg: colors.goldSoft, fg: '#8A6D12' },
};

export function Pill({ label, tone = 'neutral', icon, dot, style, size = 'md' }: { label: string; tone?: PillTone; icon?: IconName; dot?: boolean; style?: StyleProp<ViewStyle>; size?: 'sm' | 'md' }) {
  const c = tones[tone];
  return (
    <View style={[styles.pill, size === 'sm' && styles.pillSm, { backgroundColor: c.bg }, style]}>
      {dot ? <View style={[styles.dot, { backgroundColor: c.fg }]} /> : null}
      {icon ? <Icon name={icon} size={size === 'sm' ? 11 : 13} color={c.fg} /> : null}
      <T variant="caption" style={{ color: c.fg, fontWeight: '600', fontSize: size === 'sm' ? 11 : 12, lineHeight: size === 'sm' ? 14 : 16 }}>
        {label}
      </T>
    </View>
  );
}

const statusTone: Record<TxnStatus, PillTone> = { PENDING_SYNC: 'warning', SYNCED: 'info', SETTLED: 'success', FAILED: 'danger' };
const statusIcon: Record<TxnStatus, IconName> = { PENDING_SYNC: 'cloud-upload-outline', SYNCED: 'cloud-done-outline', SETTLED: 'checkmark-circle', FAILED: 'close-circle' };

export function StatusPill({ status, size = 'md', review }: { status: TxnStatus; size?: 'sm' | 'md'; review?: boolean }) {
  const { t } = useI18n();
  if (review && status === 'SYNCED') return <Pill label={t('statusREVIEW')} tone="gold" icon="eye-outline" size={size} />;
  return <Pill label={t(`status${status}`)} tone={statusTone[status]} icon={statusIcon[status]} size={size} />;
}

export { statusColor };

const styles = StyleSheet.create({
  pill: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: spacing.md, paddingVertical: 5, borderRadius: radii.pill, alignSelf: 'flex-start' },
  pillSm: { paddingHorizontal: spacing.sm, paddingVertical: 3 },
  dot: { width: 6, height: 6, borderRadius: 3 },
});
