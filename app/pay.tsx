import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { NumericKeypad } from '@/components/NumericKeypad';
import { QrCard } from '@/components/QrCard';
import { useDemoBroadcast } from '@/hooks/useDemoBroadcast';
import { QrScanner } from '@/components/QrScanner';
import { Button, Card, Icon, Input, Pill, Screen, T } from '@/components/ui';
import { formatINR, parseAmountInput } from '@/domain/money';
import { formatDateTime } from '@/domain/time';
import type { LimitCheckResult } from '@/domain/limits';
import { useLedger, bumpLedger } from '@/hooks/useLedger';
import { useAuth } from '@/providers/AuthProvider';
import { useI18n } from '@/providers/I18nProvider';
import { useNetwork } from '@/providers/NetworkProvider';
import { ApiError } from '@/services/api';
import { toast } from '@/services/notifications';
import { attachVendorReceipt, checkOfflineLimits, createOfflinePayment, LimitError, NoCredentialError, payOnline, type OfflinePaymentResult } from '@/services/payment';
import { decodeQr } from '@/services/qr';
import { announceRole, subscribe } from '@/services/stageBridge';
import { colors, radii, spacing } from '@/theme';

const QUICK = [2000, 5000, 10000, 20000, 50000];

type Stage = 'amount' | 'code' | 'scanReceipt' | 'done';

/**
 * Pay flow: amount -> signed offline code (or online payment) -> optional receipt scan.
 * Entered from a scanned stall QR or from the stall directory.
 */
export default function Pay() {
  const { t } = useI18n();
  const router = useRouter();
  const params = useLocalSearchParams<{ merchant_id: string; merchant_name: string; category?: string; verified?: string; zone?: string }>();
  const { user, credential } = useAuth();
  const { isOnline } = useNetwork();
  const ledger = useLedger();

  const merchant = useMemo(() => ({ id: params.merchant_id ?? '', name: params.merchant_name ?? t('unknownStall'), category: params.category ?? 'GENERAL', verified: params.verified === '1' }), [params, t]);
  const [input, setInput] = useState('');
  const [memo, setMemo] = useState('');
  const [stage, setStage] = useState<Stage>('amount');
  const [busy, setBusy] = useState<'offline' | 'online' | null>(null);
  const [result, setResult] = useState<OfflinePaymentResult | null>(null);
  const [limits, setLimits] = useState<LimitCheckResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const amount = parseAmountInput(input) ?? 0;

  useEffect(() => {
    if (!ledger || amount <= 0) {
      setLimits(null);
      return;
    }
    checkOfflineLimits(ledger, amount, credential).then(setLimits);
  }, [ledger, amount, credential]);

  const offlineBlocked = amount > 0 && limits !== null && !limits.ok;
  const limitMessage = offlineBlocked
    ? limits!.failures.includes('EXCEEDS_SINGLE_TXN_LIMIT') || limits!.failures.includes('EXCEEDS_CERT_TXN_LIMIT')
      ? t('limitExceeded', { limit: formatINR(limits!.effectivePerTxnLimit, { showPaise: false }) })
      : t('dailyLimitExceeded', { left: formatINR(limits!.remainingToday, { showPaise: false }) })
    : null;

  const generateOffline = async () => {
    if (!ledger || !user) return;
    setBusy('offline');
    setError(null);
    try {
      const r = await createOfflinePayment({ merchant, amount, memo: memo.trim() || undefined, ledger, payerName: user.name });
      setResult(r);
      bumpLedger();
      setStage('code');
    } catch (err) {
      if (err instanceof NoCredentialError) setError(t('errNoCredential'));
      else if (err instanceof LimitError) setError(t('limitExceeded', { limit: formatINR(err.result.effectivePerTxnLimit, { showPaise: false }) }));
      else setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const goOnline = async () => {
    if (!ledger || !user) return;
    setBusy('online');
    setError(null);
    try {
      const r = await payOnline({ merchant, amount, memo: memo.trim() || undefined, ledger, payerId: user.id, payerName: user.name });
      bumpLedger();
      toast.success(t('paymentSent'), `${formatINR(amount)} → ${merchant.name}`);
      router.replace({ pathname: '/receipt', params: { id: r.txn.id } });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('errGeneric'));
    } finally {
      setBusy(null);
    }
  };

  const onReceiptScanned = async (raw: string) => {
    const parsed = decodeQr(raw);
    if (parsed.kind !== 'RECEIPT' || !ledger || !result) {
      toast.warning(t('notFreePayCode'));
      return;
    }
    if (parsed.data.receipt.transaction_id !== result.txn.id) {
      toast.warning(t('receiptTitle'), 'This receipt belongs to a different payment');
      return;
    }
    await attachVendorReceipt(ledger, parsed.data);
    bumpLedger();
    toast.success(t('accepted'), formatINR(result.txn.amount));
    router.replace({ pathname: '/receipt', params: { id: result.txn.id } });
  };

  // Demo stage: label this phone, and accept a receipt relayed back from the vendor.
  useEffect(() => announceRole('pilgrim'), []);
  // Desktop demo: keep announcing the code while it is on screen, so the vendor's window
  // picks it up whenever its accept screen opens — exactly when a camera would see it.
  useDemoBroadcast('QR', stage === 'code' ? result?.payload : null);
  useEffect(() => subscribe('RECEIPT', (m) => void onReceiptScanned(m.payload)), [result, ledger]);

  /* ---------------- stage: show code ---------------- */
  if (stage === 'code' && result) {
    return (
      <Screen title={t('paymentCodeReady')} back onBack={() => setStage('amount')}>
        <View style={{ alignItems: 'center', marginTop: spacing.sm }}>
          <T variant="amount">{formatINR(result.txn.amount)}</T>
          <T variant="body">
            {t('payingTo')} <T variant="bodyStrong">{merchant.name}</T>
          </T>
        </View>
        <View style={{ marginTop: spacing.xl }}>
          <QrCard value={result.payload} badge={t('verifiedOffline')} caption={t('showQrHint')} />
        </View>
        <Card tone="alt" elevated={false} style={{ marginTop: spacing.lg }}>
          <View style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'center' }}>
            <Icon name="time-outline" size={18} color={colors.muted} />
            <T variant="caption" style={{ flex: 1 }}>
              {t('expiresIn')} {formatDateTime(result.qr.auth.expires_at)} · {t('nonce')} {result.qr.auth.nonce.slice(0, 8)}…
            </T>
          </View>
          <T variant="caption" style={{ marginTop: spacing.xs }}>
            {isOnline ? t('onlineModeNote') : t('offlineModeNote')}
          </T>
        </Card>
        <View style={{ gap: spacing.sm, marginTop: spacing.xl }}>
          <Button title={t('scanVendorReceipt')} icon="scan-outline" variant="secondary" fullWidth onPress={() => setStage('scanReceipt')} />
          <Button title={t('iHavePaid')} icon="checkmark-circle-outline" fullWidth onPress={() => router.replace({ pathname: '/receipt', params: { id: result.txn.id } })} />
        </View>
      </Screen>
    );
  }

  if (stage === 'scanReceipt') {
    return (
      <View style={{ flex: 1, backgroundColor: '#1B120C' }}>
        <QrScanner onScan={(raw) => void onReceiptScanned(raw)} hint={t('receiptTitle')} />
        <View style={{ position: 'absolute', top: 54, left: spacing.lg }}>
          <Button title={t('back')} icon="chevron-back" variant="secondary" size="sm" onPress={() => setStage('code')} />
        </View>
      </View>
    );
  }

  /* ---------------- stage: amount ---------------- */
  return (
    <Screen title={t('payTitle')} back scroll={false}>
      <Card padding={spacing.md} style={{ marginTop: spacing.xs }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
          <View style={styles.stallIcon}>
            <Icon name="storefront-outline" size={22} color={colors.saffronDeep} />
          </View>
          <View style={{ flex: 1 }}>
            <T variant="caption">{t('payingTo')}</T>
            <T variant="heading" numberOfLines={1}>
              {merchant.name}
            </T>
          </View>
          <Pill label={merchant.verified ? t('verifiedStall') : t('unverifiedStall').split(' — ')[0]} tone={merchant.verified ? 'success' : 'warning'} icon={merchant.verified ? 'checkmark-circle' : 'alert-circle'} size="sm" />
        </View>
      </Card>

      <View style={styles.amountBox}>
        <T variant="label">{t('enterAmount')}</T>
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'center', gap: 4 }}>
          <T variant="display" tone="muted" style={{ marginBottom: 6 }}>
            ₹
          </T>
          <T variant="amount" style={{ color: offlineBlocked ? colors.danger : colors.ink }}>
            {input || '0'}
          </T>
        </View>
        {limitMessage ? (
          <T variant="caption" tone="danger" align="center">
            {limitMessage}
          </T>
        ) : limits ? (
          <T variant="caption" align="center">
            {t('dailyLimitLeft')}: {formatINR(limits.remainingToday, { showPaise: false })}
          </T>
        ) : (
          <T variant="caption" align="center">
            {isOnline ? t('onlineModeNote') : t('offlineModeNote')}
          </T>
        )}
      </View>

      <View style={{ flexDirection: 'row', gap: spacing.sm, justifyContent: 'center', marginBottom: spacing.md }}>
        {QUICK.map((q) => (
          <Pressable key={q} onPress={() => setInput(String(q / 100))} style={[styles.quick, amount === q && styles.quickActive]}>
            <T variant="caption" weight="600" style={{ color: amount === q ? colors.onSaffron : colors.inkSoft }}>
              {formatINR(q, { showPaise: false })}
            </T>
          </Pressable>
        ))}
      </View>

      <Input value={memo} onChangeText={setMemo} placeholder={`${t('note')} (${t('optional')})`} icon="pencil-outline" containerStyle={{ marginBottom: spacing.md }} maxLength={60} />

      <NumericKeypad value={input} onChange={setInput} />

      {error ? (
        <T variant="caption" tone="danger" align="center" style={{ marginTop: spacing.sm }}>
          {error}
        </T>
      ) : null}

      <View style={{ gap: spacing.sm, marginTop: spacing.lg }}>
        <Button title={isOnline ? t('payOffline') : t('generateCode')} icon="qr-code-outline" fullWidth disabled={amount <= 0 || offlineBlocked || !merchant.id} loading={busy === 'offline'} onPress={() => void generateOffline()} />
        {isOnline ? (
          <Button title={t('payOnline')} icon="flash-outline" variant="secondary" fullWidth disabled={amount <= 0 || !merchant.id} loading={busy === 'online'} onPress={() => void goOnline()} />
        ) : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  stallIcon: { width: 44, height: 44, borderRadius: radii.md, backgroundColor: colors.saffronSoft, alignItems: 'center', justifyContent: 'center' },
  amountBox: { alignItems: 'center', gap: spacing.xs, paddingVertical: spacing.lg },
  quick: { paddingHorizontal: spacing.md, paddingVertical: 7, borderRadius: radii.pill, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  quickActive: { backgroundColor: colors.saffron, borderColor: colors.saffron },
});
