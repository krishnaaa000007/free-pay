import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { QrScanner } from '@/components/QrScanner';
import { IconButton, T } from '@/components/ui';
import { verifyMerchantQR } from '@/domain/credential';
import { useI18n } from '@/providers/I18nProvider';
import { toast } from '@/services/notifications';
import { getPlatformPublicKey } from '@/services/payment';
import { decodeQr } from '@/services/qr';
import { subscribe } from '@/services/stageBridge';
import { colors, layout, spacing } from '@/theme';

/**
 * Pilgrim scanner. Understands stall codes (-> pay), vendor receipts (-> receipt view)
 * and NGO credits (informational). Anything else is politely refused.
 */
export default function PilgrimScan() {
  const { t } = useI18n();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [active, setActive] = useState(true);

  useFocusEffect(
    useCallback(() => {
      setActive(true);
      return () => setActive(false);
    }, []),
  );

  const onScan = useCallback(async (raw: string) => {
    const parsed = decodeQr(raw);
    if (parsed.kind === 'MERCHANT') {
      const key = await getPlatformPublicKey();
      const verified = key ? verifyMerchantQR(parsed.data, key) : false;
      router.push({
        pathname: '/pay',
        params: { merchant_id: parsed.data.merchant_id, merchant_name: parsed.data.name, category: parsed.data.category, verified: verified ? '1' : '0', zone: parsed.data.zone ?? '' },
      });
      return;
    }
    if (parsed.kind === 'RECEIPT') {
      router.push({ pathname: '/receipt', params: { payload: raw } });
      return;
    }
    if (parsed.kind === 'PAYMENT') {
      toast.info(t('verifyTitle'), t('vendorVerifyHint'));
      router.push({ pathname: '/vendor-verify', params: { payload: raw } });
      return;
    }
    toast.warning(t('notFreePayCode'));
  }, [router, t]);

  // Desktop demo: the stall QR may be on a second monitor, where no camera can see it.
  // The vendor's window announces the code it is displaying and we treat it as a scan.
  // Off on a phone, and the payload goes through exactly the same verification.
  useFocusEffect(useCallback(() => subscribe('MERCHANT', (m) => void onScan(m.payload)), [onScan]));

  return (
    <View style={styles.root}>
      <QrScanner onScan={(raw) => void onScan(raw)} hint={t('scanToPay')} active={active} />
      <View style={[styles.top, { top: insets.top + spacing.sm }]}>
        <IconButton icon="chevron-back" tone="ink" onPress={() => router.back()} label={t('back')} />
        <T variant="heading" style={{ color: colors.onDark }}>
          {t('scanTitle')}
        </T>
        <View style={{ width: 40 }} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#1B120C', paddingBottom: layout.tabBarHeight },
  top: { position: 'absolute', left: spacing.lg, right: spacing.lg, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
});
