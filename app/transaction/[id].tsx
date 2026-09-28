import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { QrCard } from '@/components/QrCard';
import { Button, Card, EmptyState, Icon, KV, Pill, Screen, StatusPill, T } from '@/components/ui';
import { verifyPaymentQR, verifyReceipt, FAILURE_TITLES } from '@/domain/credential';
import { formatINR } from '@/domain/money';
import { formatDateTime } from '@/domain/time';
import type { ServerTransaction, TxnStatus } from '@/domain/types';
import { useLedgerTransaction } from '@/hooks/useLedger';
import { useAuth } from '@/providers/AuthProvider';
import { useI18n } from '@/providers/I18nProvider';
import { useNetwork } from '@/providers/NetworkProvider';
import { get } from '@/services/api';
import { getPlatformPublicKey } from '@/services/payment';
import { decodeQr } from '@/services/qr';
import { colors, radii, spacing } from '@/theme';

const STEPS: TxnStatus[] = ['PENDING_SYNC', 'SYNCED', 'SETTLED'];

/**
 * Transaction detail: lifecycle timeline, the cryptographic evidence held on-device, the
 * server's fraud verdict when reachable, and the receipt QR.
 */
export default function TransactionDetail() {
  const { t } = useI18n();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const { isOnline } = useNetwork();
  const { txn, loading } = useLedgerTransaction(id);
  const server = useQuery({
    queryKey: ['txn', id],
    queryFn: () => get<{ transaction: ServerTransaction & { merchant_code?: string }; annotations: Array<{ kind: string; note: string | null; created_at: string; admin_name?: string }>; settlement: { status: string; provider_ref: string | null; processed_at: string | null } | null }>(`/api/transactions/${id}`),
    enabled: isOnline && !!id,
    retry: 0,
  });
  const [sigs, setSigs] = useState<{ auth: boolean | null; receipt: boolean | null }>({ auth: null, receipt: null });

  const payload = useMemo(() => (txn?.payload_json ? decodeQr(txn.payload_json) : null), [txn?.payload_json]);
  const receipt = useMemo(() => (txn?.receipt_json ? decodeQr(txn.receipt_json) : null), [txn?.receipt_json]);

  useEffect(() => {
    (async () => {
      const key = await getPlatformPublicKey();
      setSigs({
        auth: payload?.kind === 'PAYMENT' ? verifyPaymentQR(payload.data, { platformPublicKey: key, now: new Date(Date.parse(payload.data.auth.created_at) + 1000) }).ok : null,
        receipt: receipt?.kind === 'RECEIPT' ? verifyReceipt(receipt.data, key, new Date(Date.parse(receipt.data.receipt.issued_at) + 1000)).ok : null,
      });
    })();
  }, [payload, receipt]);

  const s = server.data?.transaction;
  const status: TxnStatus = s?.status ?? txn?.status ?? 'PENDING_SYNC';
  const amount = txn?.amount ?? s?.amount ?? 0;
  const merchantName = txn?.merchant_name ?? s?.merchant_name ?? '';
  const mode = txn?.mode ?? s?.mode ?? 'OFFLINE';
  const failed = status === 'FAILED';
  const stepIndex = failed ? 1 : STEPS.indexOf(status);

  if (loading) return <Screen title={t('details')} back />;
  if (!txn && !s) {
    return (
      <Screen title={t('details')} back>
        <EmptyState icon="receipt-outline" title={t('errGeneric')} body={isOnline ? undefined : t('errNetwork')} />
      </Screen>
    );
  }

  return (
    <Screen title={t('details')} back subtitle={id.slice(0, 8).toUpperCase()}>
      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
          <View style={[styles.icon, { backgroundColor: txn?.direction === 'IN' ? colors.successSoft : colors.saffronSoft }]}>
            <Icon name={mode === 'OFFLINE' ? 'cloud-offline-outline' : mode === 'ONLINE' ? 'flash-outline' : 'heart-outline'} size={22} color={txn?.direction === 'IN' ? colors.success : colors.saffronDeep} />
          </View>
          <View style={{ flex: 1 }}>
            <T variant="caption">{txn?.direction === 'IN' ? t('paidBy') : t('merchant')}</T>
            <T variant="heading" numberOfLines={1}>
              {txn?.direction === 'IN' ? txn.payer_name ?? s?.payer_name ?? 'Pilgrim' : merchantName}
            </T>
          </View>
          <StatusPill status={status} review={s?.fraud_decision === 'REVIEW'} />
        </View>
        <T variant="amount" style={{ marginTop: spacing.lg }}>
          {formatINR(amount)}
        </T>
        <T variant="caption">
          {formatDateTime(txn?.created_at ?? s?.created_at)} · {mode === 'OFFLINE' ? t('offline') : mode === 'ONLINE' ? t('online') : 'NGO credit'}
          {txn?.memo ? ` · ${txn.memo}` : ''}
        </T>
      </Card>

      {/* Lifecycle */}
      <Card style={{ marginTop: spacing.lg }} padding={spacing.md}>
        <View style={styles.timeline}>
          {STEPS.map((step, i) => {
            const done = i <= stepIndex && !failed;
            const current = i === stepIndex;
            const isFailed = failed && i === 1;
            return (
              <View key={step} style={styles.stepCol}>
                <View style={[styles.stepDot, done && styles.stepDone, current && styles.stepCurrent, isFailed && { backgroundColor: colors.danger, borderColor: colors.danger }]}>
                  <Icon name={isFailed ? 'close' : done ? 'checkmark' : 'ellipse-outline'} size={14} color={done || isFailed ? colors.white : colors.faint} />
                </View>
                <T variant="caption" weight={current ? '700' : '500'} align="center" style={{ color: isFailed ? colors.danger : done ? colors.ink : colors.faint }}>
                  {isFailed ? t('statusFAILED') : t(`status${step}`)}
                </T>
                <T variant="caption" align="center" style={{ fontSize: 11 }}>
                  {step === 'PENDING_SYNC' ? formatDateTime(txn?.accepted_at ?? txn?.created_at ?? s?.created_at) : step === 'SYNCED' ? (txn?.synced_at ?? s?.synced_at ? formatDateTime(txn?.synced_at ?? s?.synced_at) : '—') : txn?.settled_at ?? s?.settled_at ? formatDateTime(txn?.settled_at ?? s?.settled_at) : '—'}
                </T>
              </View>
            );
          })}
          <View style={styles.track}>
            <View style={[styles.trackFill, { width: `${(Math.max(0, stepIndex) / (STEPS.length - 1)) * 100}%`, backgroundColor: failed ? colors.danger : colors.success }]} />
          </View>
        </View>
      </Card>

      {/* Server verdict */}
      {s ? (
        <Card style={{ marginTop: spacing.lg }} padding={spacing.md}>
          <T variant="label" style={{ marginBottom: spacing.sm }}>
            Server ledger
          </T>
          <KV label="Fraud decision" value={<Pill label={s.fraud_decision ?? '—'} tone={s.fraud_decision === 'ACCEPT' ? 'success' : s.fraud_decision === 'REVIEW' ? 'gold' : 'danger'} />} />
          <KV label="Flags" value={s.fraud_flags?.length ? s.fraud_flags.map((f) => FAILURE_TITLES[f] ?? f).join(', ') : 'none'} />
          <KV label="Suspicious" value={s.suspicious ? 'yes' : 'no'} />
          {server.data?.settlement ? <KV label={t('settlement')} value={`${server.data.settlement.status}${server.data.settlement.provider_ref ? ` · ${server.data.settlement.provider_ref}` : ''}`} mono /> : null}
          {server.data?.annotations.map((a, i) => (
            <KV key={i} label={a.kind} value={`${a.note ?? ''} — ${a.admin_name ?? 'admin'}`} last={i === server.data!.annotations.length - 1} />
          ))}
          {server.data?.annotations.length === 0 ? <KV label="Annotations" value="none" last /> : null}
        </Card>
      ) : isOnline && server.isError ? (
        <Card tone="alt" elevated={false} style={{ marginTop: spacing.lg }}>
          <T variant="caption">{t('willSyncWhenOnline')}</T>
        </Card>
      ) : null}

      {/* Cryptographic evidence */}
      {txn ? (
        <Card style={{ marginTop: spacing.lg }} padding={spacing.md}>
          <T variant="label" style={{ marginBottom: spacing.sm }}>
            {t('security')}
          </T>
          <KV label={t('transactionId')} value={txn.id} mono />
          <KV label={t('nonce')} value={txn.nonce} mono />
          <KV label={t('deviceKey')} value={txn.device_id} mono />
          {txn.expires_at ? <KV label={t('expiresAt')} value={formatDateTime(txn.expires_at)} /> : null}
          {sigs.auth !== null ? <KV label="Payment signature" value={<Sig ok={sigs.auth} t={t} />} /> : null}
          {sigs.receipt !== null ? <KV label="Receipt signature" value={<Sig ok={sigs.receipt} t={t} />} /> : null}
          <KV label={t('storedLocally')} value={<Icon name="phone-portrait-outline" size={18} color={colors.success} />} last />
        </Card>
      ) : null}

      {txn?.receipt_json && user?.role === 'VENDOR' ? (
        <View style={{ marginTop: spacing.lg }}>
          <QrCard value={txn.receipt_json} size={170} badge={t('receiptTitle')} />
        </View>
      ) : null}

      <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xl }}>
        {txn?.receipt_json || txn?.payload_json ? <Button title={t('receiptTitle')} icon="receipt-outline" variant="secondary" style={{ flex: 1 }} onPress={() => router.push({ pathname: '/receipt', params: { id } })} /> : null}
        <Button title={t('done')} style={{ flex: 1 }} onPress={() => router.back()} />
      </View>
    </Screen>
  );
}

function Sig({ ok, t }: { ok: boolean; t: (k: 'signatureValid' | 'signatureInvalid') => string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <Icon name={ok ? 'shield-checkmark' : 'shield-outline'} size={16} color={ok ? colors.success : colors.danger} />
      <T variant="bodyStrong" tone={ok ? 'success' : 'danger'}>
        {ok ? t('signatureValid') : t('signatureInvalid')}
      </T>
    </View>
  );
}

const styles = StyleSheet.create({
  icon: { width: 46, height: 46, borderRadius: radii.md, alignItems: 'center', justifyContent: 'center' },
  timeline: { flexDirection: 'row', justifyContent: 'space-between', position: 'relative', paddingTop: spacing.xs },
  stepCol: { flex: 1, alignItems: 'center', gap: 4, zIndex: 1 },
  stepDot: { width: 28, height: 28, borderRadius: 14, backgroundColor: colors.card, borderWidth: 2, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  stepDone: { backgroundColor: colors.success, borderColor: colors.success },
  stepCurrent: { borderColor: colors.saffron, borderWidth: 3 },
  track: { position: 'absolute', left: '16%', right: '16%', top: 17, height: 3, backgroundColor: colors.border, borderRadius: 2 },
  trackFill: { height: 3, borderRadius: 2 },
});
