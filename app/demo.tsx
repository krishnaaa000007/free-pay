import * as Crypto from 'expo-crypto';
import React, { useCallback, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Switch, View } from 'react-native';
import nacl from 'tweetnacl';
import { QrCard } from '@/components/QrCard';
import { Button, Card, Icon, KV, Pill, Screen, StatusPill, T, type IconName } from '@/components/ui';
import { buildPaymentQR, buildVendorReceipt, verifyPaymentQR, FAILURE_TITLES } from '@/domain/credential';
import { bytesToHex, keyFingerprint, keyPairFromSeed } from '@/domain/crypto';
import { appConfig } from '@/domain/config';
import { formatINR } from '@/domain/money';
import type { SignedPaymentQR, SignedReceipt, SignedWalletCertificate, SyncResult } from '@/domain/types';
import { useI18n } from '@/providers/I18nProvider';
import { useNetwork } from '@/providers/NetworkProvider';
import { ApiError, post } from '@/services/api';
import { ensurePrng, getDeviceIdentity } from '@/services/crypto';
import { toast } from '@/services/notifications';
import { getPlatformPublicKey, refreshPlatformKey } from '@/services/payment';
import { encodeQr } from '@/services/qr';
import { colors, radii, spacing } from '@/theme';

interface DemoSession {
  pilgrim: { user_id: string; name: string; device_id: string; credential: SignedWalletCertificate; secretKey: string };
  vendor: { user_id: string; name: string; device_id: string; token: string; merchant: { id: string; name: string; code: string }; secretKey: string; publicKey: string };
}

type StepState = 'idle' | 'running' | 'done' | 'error';

/**
 * Pitch mode: the entire offline payment loop on one phone, with every cryptographic and
 * fraud-engine step made visible. Uses the same domain functions as the real screens.
 */
export default function Demo() {
  const { t } = useI18n();
  const { isOnline, forceOffline, setForceOffline } = useNetwork();
  const [session, setSession] = useState<DemoSession | null>(null);
  const [provisioning, setProvisioning] = useState(false);
  const [amount, setAmount] = useState(12000);
  const [qr, setQr] = useState<SignedPaymentQR | null>(null);
  const [verify, setVerify] = useState<{ ok: boolean; failures: string[]; ms: number } | null>(null);
  const [receipt, setReceipt] = useState<SignedReceipt | null>(null);
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);
  const [tamper, setTamper] = useState(false);
  const [steps, setSteps] = useState<Record<number, StepState>>({});
  const [error, setError] = useState<string | null>(null);

  const setStep = (i: number, s: StepState) => setSteps((prev) => ({ ...prev, [i]: s }));

  /* Step 0: provision a demo session (needs network once). */
  const provision = useCallback(async () => {
    setProvisioning(true);
    setError(null);
    try {
      ensurePrng();
      if (!(await getPlatformPublicKey())) await refreshPlatformKey();
      const me = await getDeviceIdentity();
      const pk = keyPairFromSeed(Crypto.getRandomBytes(nacl.sign.seedLength));
      const vk = keyPairFromSeed(Crypto.getRandomBytes(nacl.sign.seedLength));
      const r = await post<{ pilgrim: DemoSession['pilgrim']; vendor: Omit<DemoSession['vendor'], 'secretKey' | 'publicKey'> }>('/api/demo/session', {
        device_id: me.deviceId + '-' + bytesToHex(Crypto.getRandomBytes(3)),
        pilgrim_public_key: pk.publicKey,
        vendor_public_key: vk.publicKey,
      });
      setSession({ pilgrim: { ...r.pilgrim, secretKey: pk.secretKey }, vendor: { ...r.vendor, secretKey: vk.secretKey, publicKey: vk.publicKey } });
      setSteps({});
      setQr(null);
      setVerify(null);
      setReceipt(null);
      setSyncResult(null);
      toast.success(t('demoTitle'), `${r.pilgrim.name} ↔ ${r.vendor.merchant.name}`);
    } catch (err) {
      setError(err instanceof ApiError ? `${err.code}: ${err.message}` : (err as Error).message);
    } finally {
      setProvisioning(false);
    }
  }, [t]);

  /* Step 1: go offline. */
  const goOffline = async () => {
    setStep(1, 'running');
    await setForceOffline(true);
    setStep(1, 'done');
  };

  /* Step 2: pilgrim signs a payment authorisation. */
  const pay = () => {
    if (!session) return;
    setStep(2, 'running');
    const built = buildPaymentQR({
      cert: session.pilgrim.credential,
      deviceSecretKey: session.pilgrim.secretKey,
      merchantId: session.vendor.merchant.id,
      amount,
      transactionId: Crypto.randomUUID(),
      nonce: bytesToHex(Crypto.getRandomBytes(16)),
      now: new Date(),
      limits: appConfig.limits,
      memo: 'Chai and samosa',
    });
    // Optional tamper: bump the amount after signing to show verification catching it.
    setQr(tamper ? { ...built, auth: { ...built.auth, amount: built.auth.amount * 10 } } : built);
    setVerify(null);
    setReceipt(null);
    setSyncResult(null);
    setStep(2, 'done');
    setSteps((p) => ({ ...p, 3: 'idle', 4: 'idle', 5: 'idle' }));
  };

  /* Step 3: vendor verifies fully offline. */
  const doVerify = async () => {
    if (!qr || !session) return;
    setStep(3, 'running');
    const key = await getPlatformPublicKey();
    const started = Date.now();
    const r = verifyPaymentQR(qr, { platformPublicKey: key, expectedMerchantId: session.vendor.merchant.id, maxOfflineAgeMs: appConfig.limits.maxOfflineAgeMs });
    await new Promise((res) => setTimeout(res, 400));
    setVerify({ ok: r.ok, failures: r.failures.map((f) => f.code), ms: Date.now() - started });
    setStep(3, r.ok ? 'done' : 'error');
  };

  /* Step 4: vendor signs a receipt and stores locally. */
  const issueReceipt = () => {
    if (!qr || !session) return;
    setStep(4, 'running');
    const rc = buildVendorReceipt({ qr, merchantName: session.vendor.merchant.name, vendorSecretKey: session.vendor.secretKey, vendorPublicKey: session.vendor.publicKey, now: new Date() });
    setReceipt(rc);
    setStep(4, 'done');
  };

  /* Step 5: back online -> sync as the vendor -> fraud engine -> SYNCED. */
  const goOnlineAndSync = async () => {
    if (!qr || !receipt || !session) return;
    setStep(5, 'running');
    setError(null);
    await setForceOffline(false);
    try {
      const r = await post<{ results: SyncResult[]; summary: { accepted: number; review: number; rejected: number; duplicates: number } }>(
        '/api/transactions/sync',
        { device_id: session.vendor.device_id, items: [{ payload: qr, receipt, accepted_at: receipt.receipt.issued_at, vendor_device_id: session.vendor.device_id }], pending_after_sync: { count: 0, amount: 0 }, client: { app_version: appConfig.version, network: 'demo' } },
        { token: session.vendor.token },
      );
      const res = r.results[0];
      setSyncResult(res);
      setStep(5, res?.decision === 'REJECT' ? 'error' : 'done');
      toast[res?.decision === 'REJECT' ? 'error' : 'success'](`Server: ${res?.decision}`, res?.flags.length ? res.flags.join(', ') : 'No fraud flags');
    } catch (err) {
      setError(err instanceof ApiError ? `${err.code}: ${err.message}` : (err as Error).message);
      setStep(5, 'error');
    }
  };

  const reset = async () => {
    await setForceOffline(false);
    setQr(null);
    setVerify(null);
    setReceipt(null);
    setSyncResult(null);
    setSteps({});
    setError(null);
  };

  const stepDefs = useMemo(
    () => [
      { n: 1, title: t('demoStep1'), body: t('demoStep1Body'), icon: 'cloud-offline-outline' as IconName, action: goOffline, enabled: !!session && !forceOffline, label: t('simulateOffline') },
      { n: 2, title: t('demoStep2'), body: t('demoStep2Body'), icon: 'qr-code-outline' as IconName, action: pay, enabled: !!session, label: t('generateCode') },
      { n: 3, title: t('demoStep3'), body: t('demoStep3Body'), icon: 'finger-print-outline' as IconName, action: doVerify, enabled: !!qr, label: t('verifyTitle') },
      { n: 4, title: t('demoStep4'), body: t('demoStep4Body'), icon: 'receipt-outline' as IconName, action: issueReceipt, enabled: !!verify?.ok, label: t('accept') },
      { n: 5, title: t('demoStep5'), body: t('demoStep5Body'), icon: 'cloud-done-outline' as IconName, action: goOnlineAndSync, enabled: !!receipt, label: t('simulateOnline') + ' + ' + t('syncNow') },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t, session, forceOffline, qr, verify, receipt, amount, tamper],
  );

  return (
    <Screen title={t('demoTitle')} subtitle={t('demoSubtitle')} back>
      {/* Session */}
      <Card tone={session ? 'ink' : 'saffron'} padding={spacing.lg}>
        {session ? (
          <>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <T variant="label" style={{ color: colors.onDark, opacity: 0.75 }}>
                Demo identities
              </T>
              <Pill label={forceOffline ? t('networkForcedOffline') : isOnline ? t('online') : t('offline')} tone={forceOffline || !isOnline ? 'warning' : 'success'} dot />
            </View>
            <View style={{ flexDirection: 'row', gap: spacing.lg, marginTop: spacing.md }}>
              <Identity role={t('iAmPilgrim')} name={session.pilgrim.name} fp={keyFingerprint(session.pilgrim.credential.cert.pk)} />
              <Identity role={t('iAmVendor')} name={session.vendor.merchant.name} fp={keyFingerprint(session.vendor.publicKey)} />
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.md }}>
              <T variant="caption" style={{ color: colors.onDark, opacity: 0.8 }}>
                Simulate offline
              </T>
              <Switch value={forceOffline} onValueChange={(v) => void setForceOffline(v)} trackColor={{ true: colors.saffron, false: 'rgba(255,255,255,0.2)' }} thumbColor={colors.white} />
            </View>
          </>
        ) : (
          <>
            <T variant="title" style={{ color: colors.onSaffron }}>
              {t('demoSubtitle')}
            </T>
            <T variant="body" style={{ color: colors.onSaffron, opacity: 0.9, marginTop: spacing.xs }}>
              Provisions two throw-away device keys — a pilgrim wallet certificate signed by the platform and a vendor device — then runs the full loop below. Needs the server once.
            </T>
            <Button title="Provision demo session" icon="key-outline" variant="ink" style={{ marginTop: spacing.md }} loading={provisioning} disabled={!isOnline} onPress={() => void provision()} />
            {!isOnline ? (
              <T variant="caption" style={{ color: colors.onSaffron, marginTop: spacing.sm }}>
                {forceOffline ? t('networkForcedOffline') : t('errNetwork')}
              </T>
            ) : null}
          </>
        )}
      </Card>

      {/* Controls */}
      {session ? (
        <View style={styles.controls}>
          <View style={{ flex: 1 }}>
            <T variant="label">{t('amount')}</T>
            <View style={{ flexDirection: 'row', gap: spacing.xs, marginTop: spacing.xs, flexWrap: 'wrap' }}>
              {[12000, 50000, 180000, 250000].map((a) => (
                <Pressable key={a} onPress={() => setAmount(a)} style={[styles.amt, amount === a && styles.amtActive]}>
                  <T variant="caption" weight="600" style={{ color: amount === a ? colors.onSaffron : colors.ink }}>
                    {formatINR(a, { showPaise: false })}
                  </T>
                </Pressable>
              ))}
            </View>
            <T variant="caption" style={{ marginTop: 4 }}>
              ₹1,800 → review threshold · ₹2,500 → over offline limit
            </T>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <T variant="label">Tamper</T>
            <Switch value={tamper} onValueChange={setTamper} trackColor={{ true: colors.danger }} />
            <T variant="caption">edit amount after signing</T>
          </View>
        </View>
      ) : null}

      {/* Steps */}
      <View style={{ marginTop: spacing.lg, gap: spacing.md }}>
        {stepDefs.map((s) => {
          const state = steps[s.n] ?? 'idle';
          return (
            <Card key={s.n} padding={spacing.md} tone={state === 'done' ? 'success' : state === 'error' ? 'danger' : 'default'} elevated={state === 'idle'}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
                <View style={[styles.stepIcon, state === 'done' && { backgroundColor: colors.success }, state === 'error' && { backgroundColor: colors.danger }]}>
                  <Icon name={state === 'done' ? 'checkmark' : state === 'error' ? 'close' : s.icon} size={20} color={state === 'idle' || state === 'running' ? colors.saffronDeep : colors.white} />
                </View>
                <View style={{ flex: 1 }}>
                  <T variant="bodyStrong">
                    {s.n}. {s.title}
                  </T>
                  <T variant="caption">{s.body}</T>
                </View>
                <Button title={t('runStep')} size="sm" variant={state === 'done' ? 'secondary' : 'primary'} disabled={!s.enabled} loading={state === 'running'} onPress={() => void s.action()} />
              </View>

              {s.n === 2 && qr ? (
                <View style={{ marginTop: spacing.md, gap: spacing.xs }}>
                  <KV label={t('amount')} value={formatINR(qr.auth.amount)} />
                  <KV label={t('nonce')} value={qr.auth.nonce} mono />
                  <KV label="Signature" value={qr.auth_sig.slice(0, 24) + '…'} mono />
                  <KV label={t('expiresAt')} value={new Date(qr.auth.expires_at).toLocaleString('en-IN')} last />
                  <View style={{ alignItems: 'center', marginTop: spacing.sm }}>
                    <QrCard value={encodeQr(qr)} size={150} badge={t('offlineReady')} />
                  </View>
                </View>
              ) : null}

              {s.n === 3 && verify ? (
                <View style={{ marginTop: spacing.md }}>
                  <KV label="Platform certificate" value={<Check ok={!verify.failures.includes('INVALID_CERTIFICATE')} />} />
                  <KV label="Device signature" value={<Check ok={!verify.failures.includes('INVALID_SIGNATURE')} />} />
                  <KV label="Expiry / staleness" value={<Check ok={!verify.failures.some((f) => ['EXPIRED_AUTHORIZATION', 'STALE_OFFLINE_AUTHORIZATION', 'TAMPERED_EXPIRY'].includes(f))} />} />
                  <KV label="Merchant match" value={<Check ok={!verify.failures.includes('MERCHANT_MISMATCH')} />} />
                  <KV label="Verified in" value={`${verify.ms} ms · offline`} last={verify.ok} />
                  {!verify.ok ? <KV label="Failures" value={verify.failures.map((f) => FAILURE_TITLES[f] ?? f).join(', ')} last /> : null}
                </View>
              ) : null}

              {s.n === 4 && receipt ? (
                <View style={{ marginTop: spacing.md }}>
                  <KV label={t('signedBy')} value={`Vendor device ${keyFingerprint(receipt.signer_pk)}`} mono />
                  <KV label={t('status')} value={<StatusPill status="PENDING_SYNC" />} last />
                </View>
              ) : null}

              {s.n === 5 && syncResult ? (
                <View style={{ marginTop: spacing.md }}>
                  <KV label="Decision" value={<Pill label={syncResult.decision} tone={syncResult.decision === 'ACCEPT' ? 'success' : syncResult.decision === 'REVIEW' ? 'gold' : syncResult.decision === 'DUPLICATE' ? 'neutral' : 'danger'} />} />
                  <KV label="Flags" value={syncResult.flags.length ? syncResult.flags.join(', ') : 'none'} />
                  <KV label={t('status')} value={<StatusPill status={syncResult.status} review={syncResult.decision === 'REVIEW'} />} />
                  {syncResult.synced_at ? <KV label={t('syncedAt')} value={new Date(syncResult.synced_at).toLocaleTimeString('en-IN')} last /> : null}
                  {syncResult.message ? <KV label="Message" value={syncResult.message} last /> : null}
                </View>
              ) : null}
            </Card>
          );
        })}
      </View>

      {error ? (
        <Card tone="danger" elevated={false} style={{ marginTop: spacing.md }}>
          <T variant="caption">{error}</T>
        </Card>
      ) : null}

      {session ? (
        <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xl }}>
          <Button title="Replay same code (replay attack)" icon="repeat-outline" variant="secondary" style={{ flex: 1 }} disabled={!syncResult} onPress={() => void goOnlineAndSync()} />
          <Button title={t('resetDemo')} icon="refresh-outline" variant="ghost" onPress={() => void reset()} />
        </View>
      ) : null}
    </Screen>
  );
}

function Identity({ role, name, fp }: { role: string; name: string; fp: string }) {
  return (
    <View style={{ flex: 1 }}>
      <T variant="caption" style={{ color: colors.onDark, opacity: 0.7 }}>
        {role}
      </T>
      <T variant="bodyStrong" style={{ color: colors.onDark }} numberOfLines={1}>
        {name}
      </T>
      <T variant="mono" style={{ color: colors.saffron }}>
        {fp}
      </T>
    </View>
  );
}

function Check({ ok }: { ok: boolean }) {
  return <Icon name={ok ? 'checkmark-circle' : 'close-circle'} size={20} color={ok ? colors.success : colors.danger} />;
}

const styles = StyleSheet.create({
  controls: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.lg, backgroundColor: colors.card, borderRadius: radii.lg, padding: spacing.md, borderWidth: 1, borderColor: colors.hairline },
  amt: { paddingHorizontal: spacing.sm + 2, paddingVertical: 6, borderRadius: radii.pill, backgroundColor: colors.parchmentDeep },
  amtActive: { backgroundColor: colors.saffron },
  stepIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.saffronSoft, alignItems: 'center', justifyContent: 'center' },
});
