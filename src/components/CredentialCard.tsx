import React from 'react';
import { StyleSheet, View } from 'react-native';
import { keyFingerprint } from '../domain/crypto';
import { credentialHealth } from '../domain/limits';
import { formatINR } from '../domain/money';
import type { SignedWalletCertificate } from '../domain/types';
import { useI18n } from '../providers/I18nProvider';
import { colors, radii, spacing } from '../theme';
import { Button, Card, Icon, Pill, T } from './ui';

/**
 * The pilgrim's wallet credential rendered like a travel pass: who, which device, limits
 * and how long it stays valid offline. This is the object that makes offline payments
 * possible, so we make it feel tangible.
 */
export function CredentialCard({ credential, remainingToday, onRefresh, refreshing, online }: { credential: SignedWalletCertificate | null; remainingToday: number; onRefresh: () => void; refreshing?: boolean; online: boolean }) {
  const { t } = useI18n();
  if (!credential) {
    return (
      <Card tone="warning">
        <View style={{ flexDirection: 'row', gap: spacing.md, alignItems: 'center' }}>
          <Icon name="key-outline" size={26} color={colors.warning} />
          <View style={{ flex: 1 }}>
            <T variant="bodyStrong">{t('walletCredential')}</T>
            <T variant="caption">{t('errNoCredential')}</T>
          </View>
        </View>
        {online ? <Button title={t('refreshCredential')} size="sm" variant="secondary" style={{ marginTop: spacing.md }} onPress={onRefresh} loading={refreshing} /> : null}
      </Card>
    );
  }
  const { cert } = credential;
  const health = credentialHealth(cert.expires_at);
  const statusLabel = health.state === 'EXPIRED' ? t('credentialExpired') : health.state === 'EXPIRING' ? t('credentialExpiring', { hours: health.hoursLeft }) : t('credentialValid', { days: health.daysLeft });

  return (
    <Card tone="ink" padding={spacing.xl}>
      <View style={styles.topRow}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
          <View style={styles.chip}>
            <Icon name="shield-checkmark" size={16} color={colors.saffron} />
          </View>
          <T variant="label" style={{ color: colors.onDark, opacity: 0.8 }}>
            {t('walletCredential')}
          </T>
        </View>
        <Pill label={health.state === 'EXPIRED' ? t('statusFAILED') : t('offlineReady')} tone={health.state === 'EXPIRED' ? 'danger' : health.state === 'EXPIRING' ? 'warning' : 'success'} dot />
      </View>

      <T variant="display" style={{ color: colors.onDark, marginTop: spacing.lg }} numberOfLines={1}>
        {cert.name}
      </T>
      <T variant="caption" style={{ color: colors.onDark, opacity: 0.75 }}>
        {statusLabel}
      </T>

      <View style={styles.limitsRow}>
        <View style={{ flex: 1 }}>
          <T variant="label" style={{ color: colors.onDark, opacity: 0.6 }}>
            {t('dailyLimitLeft')}
          </T>
          <T variant="title" style={{ color: colors.saffron }}>
            {formatINR(remainingToday, { showPaise: false })}
          </T>
          <View style={styles.track}>
            <View style={[styles.fill, { width: `${Math.max(3, Math.min(100, (remainingToday / cert.limits.daily) * 100))}%` }]} />
          </View>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <T variant="label" style={{ color: colors.onDark, opacity: 0.6 }}>
            {t('perTxnLimit')}
          </T>
          <T variant="title" style={{ color: colors.onDark }}>
            {formatINR(cert.limits.per_txn, { showPaise: false })}
          </T>
        </View>
      </View>

      <View style={styles.footer}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Icon name="phone-portrait-outline" size={14} color={colors.onDark} />
          <T variant="mono" style={{ color: colors.onDark, opacity: 0.8 }}>
            {t('deviceBound')} · {keyFingerprint(cert.pk)}
          </T>
        </View>
        {online && health.state !== 'FRESH' ? (
          <Button title={t('refreshCredential')} size="sm" variant="secondary" onPress={onRefresh} loading={refreshing} />
        ) : null}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  chip: { width: 28, height: 28, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center' },
  limitsRow: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.lg, marginTop: spacing.xl },
  track: { height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.15)', marginTop: spacing.sm, overflow: 'hidden' },
  fill: { height: 6, borderRadius: 3, backgroundColor: colors.saffron },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.xl, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.12)', gap: spacing.sm },
});
