import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import { Share, View } from 'react-native';
import { QrCard } from '@/components/QrCard';
import { useDemoBroadcast } from '@/hooks/useDemoBroadcast';
import { ReceiptView } from '@/components/ReceiptView';
import { Button, Card, EmptyState, Screen, T } from '@/components/ui';
import { verifyReceipt } from '@/domain/credential';
import { formatINR } from '@/domain/money';
import type { SignedReceipt } from '@/domain/types';
import { useCountdown } from '@/hooks/useData';
import { useLedgerTransaction } from '@/hooks/useLedger';
import { useAuth } from '@/providers/AuthProvider';
import { useI18n } from '@/providers/I18nProvider';
import { getPlatformPublicKey } from '@/services/payment';
import { decodeQr } from '@/services/qr';
import { spacing } from '@/theme';

/**
 * Receipt viewer. Opens from a ledger id (after paying/accepting) or from a scanned
 * receipt payload. Signature is re-verified on-device every time it is shown.
 */
export default function ReceiptScreen() {
  const { t } = useI18n();
  const router = useRouter();
  const { user } = useAuth();
  const params = useLocalSearchParams<{ id?: string; payload?: string }>();
  const { txn, loading } = useLedgerTransaction(params.id);
  const [valid, setValid] = useState<boolean | null>(null);

  const receipt = useMemo<SignedReceipt | null>(() => {
    const raw = params.payload ?? txn?.receipt_json ?? null;
    if (!raw) return null;
    const parsed = decodeQr(raw);
    return parsed.kind === 'RECEIPT' ? parsed.data : null;
  }, [params.payload, txn?.receipt_json]);

  useEffect(() => {
    if (!receipt) return;
    getPlatformPublicKey().then((key) => setValid(verifyReceipt(receipt, key).ok));
  }, [receipt]);

  const online = receipt?.receipt.mode === 'ONLINE';
  const countdown = useCountdown(online ? receipt?.receipt.expires_at : null);
  const receiptPayload = params.payload ?? txn?.receipt_json ?? null;

  // Desktop demo: announce whichever code this screen is showing so the other window can
  // pick it up off the second monitor. Declared before the early returns below.
  useDemoBroadcast('RECEIPT', user?.role === 'VENDOR' ? receiptPayload : null);
  useDemoBroadcast('QR', !receipt && txn?.payload_json ? txn.payload_json : null);

  if (loading) return <Screen title={t('receiptTitle')} back />;

  // Pilgrim offline payment without a vendor receipt yet: show the pending summary.
  if (!receipt && txn) {
    return (
      <Screen title={t('receiptTitle')} back>
        <Card>
          <T variant="caption">{txn.merchant_name}</T>
          <T variant="amount">{formatINR(txn.amount)}</T>
          <T variant="body" style={{ marginTop: spacing.sm }}>
            {t('willSyncWhenOnline')}
          </T>
        </Card>
        {txn.payload_json ? (
          <View style={{ marginTop: spacing.lg }}>
            <QrCard value={txn.payload_json} badge={t('verifiedOffline')} caption={t('showQrHint')} />
          </View>
        ) : null}
        <Button title={t('done')} fullWidth style={{ marginTop: spacing.xl }} onPress={() => router.dismissTo('/')} />
      </Screen>
    );
  }

  if (!receipt) {
    return (
      <Screen title={t('receiptTitle')} back>
        <EmptyState icon="receipt-outline" title={t('notFreePayCode')} />
      </Screen>
    );
  }

  return (
    <Screen title={t('receiptTitle')} back subtitle={online && !countdown.expired ? `${t('validFor', { minutes: Math.ceil(countdown.totalSeconds / 60) })} · ${countdown.label}` : undefined}>
      <ReceiptView receipt={receipt} status={txn?.status} syncedAt={txn?.synced_at} signatureValid={valid} />

      {user?.role === 'VENDOR' && receiptPayload ? (
        <View style={{ marginTop: spacing.xl }}>
          <QrCard value={receiptPayload} size={180} caption={t('showToVendor').replace('vendor', 'pilgrim')} badge={t('receiptTitle')} />
        </View>
      ) : null}
      {user?.role === 'PILGRIM' && online && receiptPayload && !countdown.expired ? (
        <View style={{ marginTop: spacing.xl }}>
          <QrCard value={receiptPayload} size={180} caption={t('showToVendor')} badge={t('onlineReceipt')} />
        </View>
      ) : null}

      <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xl }}>
        <Button
          title={t('share')}
          icon="share-outline"
          variant="secondary"
          style={{ flex: 1 }}
          onPress={() => void Share.share({ message: `Free Pay receipt ${receipt.receipt.transaction_id}\n${receipt.receipt.merchant_name}: ${formatINR(receipt.receipt.amount)}\n${receiptPayload ?? ''}` }).catch(() => undefined)}
        />
        <Button title={t('done')} style={{ flex: 1 }} onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} />
      </View>
    </Screen>
  );
}
