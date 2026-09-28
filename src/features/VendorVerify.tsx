import { useFocusEffect, useRouter } from 'expo-router';
import * as Speech from 'expo-speech';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { QrScanner } from '../components/QrScanner';
import { Button, Card, Icon, IconButton, KV, Pill, Screen, T } from '../components/ui';
import { FAILURE_TITLES, verifyNgoCredit, verifyReceipt } from '../domain/credential';
import { formatINR } from '../domain/money';
import { formatDateTime, relativeTime } from '../domain/time';
import type { SignedNgoCredit, SignedPaymentQR, SignedReceipt } from '../domain/types';
import { bumpLedger, useLedger } from '../hooks/useLedger';
import { speechLanguageTag } from '../i18n';
import { useAuth } from '../providers/AuthProvider';
import { useI18n } from '../providers/I18nProvider';
import { useNetwork } from '../providers/NetworkProvider';
import { ApiError, post } from '../services/api';
import { toast } from '../services/notifications';
import { acceptNgoCredit, acceptOfflinePayment, getPlatformPublicKey, verifyForVendor, type VendorVerification } from '../services/payment';
import { decodeQr } from '../services/qr';
import { playAccepted, playRejected } from '../services/sound';
import { announceRole, isStageEmbedded, publishReceipt, subscribe } from '../services/stageBridge';
import { colors, layout, radii, spacing } from '../theme';

type Scanned = { kind: 'PAYMENT'; qr: SignedPaymentQR; check: VendorVerification } | { kind: 'RECEIPT'; receipt: SignedReceipt; ok: boolean; reason?: string } | { kind: 'NGO_CREDIT'; credit: SignedNgoCredit; ok: boolean; reason?: string };

/**
 * Vendor "accept payment" flow. Scans a pilgrim code, verifies EVERYTHING it can offline
 * (platform certificate, device signature, expiry, staleness, limits, local replay) and,
 * on accept, signs a receipt and stores the payment as PENDING_SYNC.
 */
export function VendorVerify({ embedded, initialPayload, bottomInset = 0 }: { embedded?: boolean; initialPayload?: string; bottomInset?: number }) {
  const { t, language } = useI18n();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { merchant } = useAuth();
  const { isOnline } = useNetwork();
  const ledger = useLedger();
  const [scanned, setScanned] = useState<Scanned | null>(null);
  const [busy, setBusy] = useState(false);
  const [active, setActive] = useState(true);
  const [verifying, setVerifying] = useState(false);

  useFocusEffect(
    useCallback(() => {
      setActive(true);
      return () => setActive(false);
    }, []),
  );

  const handleRaw = useCallback(
    async (raw: string) => {
      if (!ledger || !merchant) return;
      const parsed = decodeQr(raw);
      setVerifying(true);
      // Small deliberate pause so the "verifying signature" state is perceivable in a demo.
      await new Promise((r) => setTimeout(r, 450));
      const key = await getPlatformPublicKey();
      if (parsed.kind === 'PAYMENT') {
        const check = await verifyForVendor(parsed.data, { merchantId: merchant.id, ledger });
        setScanned({ kind: 'PAYMENT', qr: parsed.data, check });
      } else if (parsed.kind === 'RECEIPT') {
        const r = verifyReceipt(parsed.data, key);
        if (r.ok && isOnline && parsed.data.issuer === 'PLATFORM') {
          try {
            const server = await post<{ ok: boolean; reason?: string }>('/api/transactions/verify-receipt', { receipt: parsed.data });
            setScanned({ kind: 'RECEIPT', receipt: parsed.data, ok: server.ok, reason: server.reason });
          } catch (err) {
            setScanned({ kind: 'RECEIPT', receipt: parsed.data, ok: r.ok, reason: err instanceof ApiError ? err.code : undefined });
          }
        } else setScanned({ kind: 'RECEIPT', receipt: parsed.data, ok: r.ok, reason: r.reason });
      } else if (parsed.kind === 'NGO_CREDIT') {
        const r = verifyNgoCredit(parsed.data, key);
        const dup = await ledger.hasNonce(parsed.data.credit.nonce);
        setScanned({ kind: 'NGO_CREDIT', credit: parsed.data, ok: r.ok && !dup, reason: dup ? 'DUPLICATE_NONCE' : r.reason });
      } else {
        toast.warning(t('notFreePayCode'));
      }
      setVerifying(false);
    },
    [ledger, merchant, isOnline, t],
  );

  useEffect(() => {
    if (initialPayload) void handleRaw(initialPayload);
  }, [initialPayload, handleRaw]);

  // The counter is loud: give the verdict a sound the moment a code is read.
  useEffect(() => {
    if (!scanned) return;
    const ok = scanned.kind === 'PAYMENT' ? scanned.check.acceptable : scanned.ok;
    if (!ok) playRejected();
  }, [scanned]);

  // Desktop demo: the pilgrim's window announces the code it is displaying, standing in for
  // the camera (stage iframes, or two windows on two monitors). A displayed code repeats
  // every couple of seconds, so ignore it while one is already on screen for the vendor.
  const bridgeBusy = useRef(false);
  bridgeBusy.current = !!scanned || verifying || busy;
  useEffect(() => announceRole('vendor'), []);
  useEffect(
    () =>
      subscribe('QR', (m) => {
        if (!bridgeBusy.current) void handleRaw(m.payload);
      }),
    [handleRaw],
  );

  const accept = async () => {
    if (!scanned || !ledger || !merchant) return;
    setBusy(true);
    try {
      if (scanned.kind === 'PAYMENT') {
        const r = await acceptOfflinePayment({ qr: scanned.qr, merchant, ledger });
        bumpLedger();
        publishReceipt(r.payload);
        playAccepted();
        toast.success(t('accepted'), formatINR(r.txn.amount));
        void Speech.speak(`${t('accepted')}. ${formatINR(r.txn.amount, { symbol: '' })} rupees`, { language: speechLanguageTag(language) });
        router.replace({ pathname: '/receipt', params: { id: r.txn.id } });
      } else if (scanned.kind === 'NGO_CREDIT') {
        const txn = await acceptNgoCredit({ credit: scanned.credit, merchant, ledger, online: isOnline });
        bumpLedger();
        playAccepted();
        toast.success(t('ngoCreditAccepted'), formatINR(txn.amount));
        router.replace({ pathname: '/transaction/[id]', params: { id: txn.id } });
      }
    } catch (err) {
      playRejected();
      toast.error(t('rejected'), FAILURE_TITLES[(err as Error).message] ?? (err as Error).message);
      setScanned(null);
    } finally {
      setBusy(false);
    }
  };

  const reset = () => setScanned(null);

  /* ---------------- result view ---------------- */
  if (scanned) {
    const ok = scanned.kind === 'PAYMENT' ? scanned.check.acceptable : scanned.ok;
    const failures = scanned.kind === 'PAYMENT' ? [...scanned.check.verification.failures.map((f) => f.code), ...scanned.check.limits.failures, ...(scanned.check.duplicate ? ['DUPLICATE_NONCE'] : [])] : scanned.ok ? [] : [scanned.reason ?? 'INVALID'];
    const amount = scanned.kind === 'PAYMENT' ? scanned.qr.auth.amount : scanned.kind === 'RECEIPT' ? scanned.receipt.receipt.amount : scanned.credit.credit.amount;
    const title = scanned.kind === 'PAYMENT' ? scanned.qr.cert.cert.name : scanned.kind === 'RECEIPT' ? scanned.receipt.receipt.merchant_name : scanned.credit.credit.ngo_name;
    const warnings = scanned.kind === 'PAYMENT' ? scanned.check.warnings : [];

    return (
      <Screen title={t('verifyTitle')} back={!embedded} onBack={reset} bottomInset={bottomInset}>
        <Card tone={ok ? 'success' : 'danger'} elevated={false}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
            <View style={[styles.verdictIcon, { backgroundColor: ok ? colors.success : colors.danger }]}>
              <Icon name={ok ? 'shield-checkmark' : 'shield-outline'} size={26} color={colors.white} />
            </View>
            <View style={{ flex: 1 }}>
              <T variant="heading">{ok ? t('verified') : t('rejected')}</T>
              <T variant="caption">{ok ? t('verifiedOffline') : failures.map((f) => FAILURE_TITLES[f] ?? f).join(' · ')}</T>
            </View>
          </View>
        </Card>

        <View style={{ alignItems: 'center', marginVertical: spacing.xl }}>
          <T variant="amount">{formatINR(amount)}</T>
          <T variant="body">
            {scanned.kind === 'PAYMENT' ? t('paidBy') : scanned.kind === 'RECEIPT' ? t('merchant') : 'NGO'} <T variant="bodyStrong">{title}</T>
          </T>
          <View style={{ flexDirection: 'row', gap: spacing.xs, marginTop: spacing.sm }}>
            <Pill label={scanned.kind === 'PAYMENT' ? t('offlineReceipt').replace(' receipt', '') : scanned.kind === 'RECEIPT' ? (scanned.receipt.receipt.mode === 'ONLINE' ? t('onlineReceipt') : t('offlineReceipt')) : 'NGO credit'} tone="saffron" />
            {warnings.includes('ABOVE_REVIEW_THRESHOLD') ? <Pill label={t('needsReview')} tone="gold" icon="eye-outline" /> : null}
          </View>
        </View>

        <Card padding={spacing.md}>
          {scanned.kind === 'PAYMENT' ? (
            <>
              <KV label={t('transactionId')} value={scanned.qr.auth.transaction_id} mono />
              <KV label={t('nonce')} value={scanned.qr.auth.nonce} mono />
              <KV label={t('createdAt')} value={`${formatDateTime(scanned.qr.auth.created_at)} (${relativeTime(scanned.qr.auth.created_at)})`} />
              <KV label={t('expiresAt')} value={formatDateTime(scanned.qr.auth.expires_at)} />
              <KV label={t('credential')} value={`${t('expiresAt')} ${formatDateTime(scanned.qr.cert.cert.expires_at)}`} />
              <KV label={t('deviceKey')} value={scanned.qr.cert.cert.device_id} mono />
              {scanned.qr.auth.memo ? <KV label={t('note')} value={scanned.qr.auth.memo} /> : null}
              <KV label={t('status')} value={<Pill label={ok ? t('accept') : t('reject')} tone={ok ? 'success' : 'danger'} />} last />
            </>
          ) : scanned.kind === 'RECEIPT' ? (
            <>
              <KV label={t('transactionId')} value={scanned.receipt.receipt.transaction_id} mono />
              <KV label={t('createdAt')} value={formatDateTime(scanned.receipt.receipt.created_at)} />
              <KV label={t('expiresAt')} value={formatDateTime(scanned.receipt.receipt.expires_at)} />
              <KV label={t('signedBy')} value={scanned.receipt.issuer === 'PLATFORM' ? 'Free Pay platform' : 'Vendor device'} last />
            </>
          ) : (
            <>
              <KV label="Credit" value={scanned.credit.credit.credit_id} mono />
              <KV label="Purpose" value={scanned.credit.credit.purpose} />
              <KV label={t('expiresAt')} value={formatDateTime(scanned.credit.credit.expires_at)} last />
            </>
          )}
        </Card>

        <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xl }}>
          <Button title={scanned.kind === 'RECEIPT' ? t('done') : t('reject')} variant="secondary" style={{ flex: 1 }} onPress={reset} />
          {scanned.kind !== 'RECEIPT' ? <Button title={t('accept')} icon="checkmark" variant="success" style={{ flex: 1.4 }} disabled={!ok} loading={busy} onPress={() => void accept()} /> : null}
        </View>
      </Screen>
    );
  }

  /* ---------------- scanner ---------------- */
  return (
    <View style={[styles.root, { paddingBottom: bottomInset }]}>
      <QrScanner onScan={(raw) => void handleRaw(raw)} hint={verifying ? t('verifying') : t('vendorVerifyHint')} active={active && !verifying} camera={!isStageEmbedded()} />
      <View style={[styles.top, { top: insets.top + spacing.sm }]}>
        {!embedded ? <IconButton icon="chevron-back" tone="ink" onPress={() => router.back()} label={t('back')} /> : <View style={{ width: 40 }} />}
        <T variant="heading" style={{ color: colors.onDark }}>
          {t('acceptPayment')}
        </T>
        <View style={{ width: 40 }} />
      </View>
      {verifying ? (
        <View style={styles.verifying}>
          <Icon name="finger-print" size={22} color={colors.saffron} />
          <T variant="bodyStrong" style={{ color: colors.onDark }}>
            {t('verifying')}
          </T>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#1B120C' },
  top: { position: 'absolute', left: spacing.lg, right: spacing.lg, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  verifying: { position: 'absolute', bottom: layout.tabBarHeight + 40, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: 'rgba(43,29,20,0.85)', paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderRadius: radii.pill },
  verdictIcon: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
});
