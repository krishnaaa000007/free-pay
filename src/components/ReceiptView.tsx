import React from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { keyFingerprint } from '../domain/crypto';
import { formatINR } from '../domain/money';
import { formatDateTime } from '../domain/time';
import type { SignedReceipt, TxnStatus } from '../domain/types';
import { useI18n } from '../providers/I18nProvider';
import { shortId } from '../services/qr';
import { colors, radii, shadows, spacing } from '../theme';
import { Icon, KV, StatusPill, T } from './ui';

/**
 * A receipt rendered like a thermal-printer slip, complete with a perforated edge. Shows
 * every field the protocol carries so the cryptographic story is visible to the eye.
 */
export function ReceiptView({ receipt, status, syncedAt, signatureValid, children }: { receipt: SignedReceipt; status?: TxnStatus; /** Live ledger sync time; the signed document itself always carries null. */ syncedAt?: string | null; signatureValid: boolean | null; children?: React.ReactNode }) {
  const { t } = useI18n();
  const r = receipt.receipt;
  return (
    <View style={[styles.slip, shadows.raised]}>
      <ZigZag flip />
      <View style={styles.body}>
        <View style={{ alignItems: 'center', gap: 4 }}>
          <View style={styles.stamp}>
            <Icon name="leaf" size={16} color={colors.saffronDeep} />
            <T variant="label" tone="saffron">
              Free Pay
            </T>
          </View>
          <T variant="title" align="center">
            {r.merchant_name}
          </T>
          <T variant="caption">{r.mode === 'OFFLINE' ? t('offlineReceipt') : t('onlineReceipt')}</T>
        </View>

        <View style={styles.amountBox}>
          <T variant="label">{t('amount')}</T>
          <T variant="amount">{formatINR(r.amount)}</T>
          <StatusPill status={status ?? r.status} />
        </View>

        <View style={styles.dashed} />

        <KV label={t('receiptId')} value={shortId(r.transaction_id)} mono />
        <KV label={t('transactionId')} value={r.transaction_id} mono />
        <KV label={t('nonce')} value={r.nonce.slice(0, 16) + '…'} mono />
        <KV label={t('createdAt')} value={formatDateTime(r.created_at)} />
        <KV label={t('expiresAt')} value={formatDateTime(r.expires_at)} />
        <KV label={t('syncedAt')} value={syncedAt ?? r.synced_at ? formatDateTime(syncedAt ?? r.synced_at) : t('willSyncWhenOnline')} />
        <KV label={t('signedBy')} value={`${receipt.issuer === 'PLATFORM' ? 'Free Pay platform' : 'Vendor device'} · ${keyFingerprint(receipt.signer_pk)}`} mono />
        <KV
          label={t('status')}
          value={
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Icon name={signatureValid === null ? 'help-circle-outline' : signatureValid ? 'shield-checkmark' : 'shield-outline'} size={16} color={signatureValid === false ? colors.danger : colors.success} />
              <T variant="bodyStrong" tone={signatureValid === false ? 'danger' : 'success'}>
                {signatureValid === null ? '…' : signatureValid ? t('signatureValid') : t('signatureInvalid')}
              </T>
            </View>
          }
          last
        />
        {children}
      </View>
      <ZigZag />
    </View>
  );
}

function ZigZag({ flip }: { flip?: boolean }) {
  const teeth = 28;
  const w = 12;
  const d = Array.from({ length: teeth })
    .map((_, i) => `L${i * w + w / 2},${flip ? 10 : 0} L${(i + 1) * w},${flip ? 0 : 10}`)
    .join(' ');
  return (
    <Svg width="100%" height={10} viewBox={`0 0 ${teeth * w} 10`} preserveAspectRatio="none">
      <Path d={`M0,${flip ? 0 : 10} ${d} ${flip ? `L${teeth * w},10 L0,10` : `L${teeth * w},0 L0,0`} Z`} fill={colors.card} />
    </Svg>
  );
}

const styles = StyleSheet.create({
  slip: { borderRadius: radii.xs },
  body: { backgroundColor: colors.card, paddingHorizontal: spacing.xl, paddingVertical: spacing.lg },
  stamp: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.saffronSoft, paddingHorizontal: spacing.md, paddingVertical: 4, borderRadius: radii.pill },
  amountBox: { alignItems: 'center', gap: spacing.xs, marginVertical: spacing.lg },
  dashed: { borderTopWidth: 1.5, borderStyle: 'dashed', borderColor: colors.borderStrong, marginBottom: spacing.xs },
});
