import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLedgerStats } from '../hooks/useLedger';
import { useAuth } from '../providers/AuthProvider';
import { useI18n } from '../providers/I18nProvider';
import { useNetwork } from '../providers/NetworkProvider';
import { colors, spacing } from '../theme';
import { Icon, T } from './ui';

/**
 * Slim banner pinned under the status bar whenever the app is offline. Vendors also see
 * how many accepted payments are waiting to sync. Slides in/out so it never feels jarring.
 */
export function OfflineBanner() {
  const { isOnline, forceOffline } = useNetwork();
  const { user, status } = useAuth();
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  const { stats } = useLedgerStats('IN');
  const anim = useRef(new Animated.Value(0)).current;
  const visible = !isOnline && status === 'signedIn';

  useEffect(() => {
    Animated.spring(anim, { toValue: visible ? 1 : 0, useNativeDriver: true, friction: 9, tension: 60 }).start();
  }, [visible, anim]);

  const pending = user?.role === 'VENDOR' ? stats.pendingCount : 0;

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.wrap,
        { top: insets.top + 4, opacity: anim, transform: [{ translateY: Animated.multiply(Animated.subtract(1, anim), -30) }] },
      ]}
    >
      <View style={styles.pill}>
        <View style={styles.dot} />
        <Icon name="cloud-offline-outline" size={14} color={colors.onDark} />
        <T variant="caption" style={{ color: colors.onDark, fontWeight: '600' }}>
          {forceOffline ? t('networkForcedOffline') : t('toastOffline')}
        </T>
        {pending > 0 ? (
          <View style={styles.count}>
            <T variant="caption" style={{ color: colors.ink, fontWeight: '700', fontSize: 11 }}>
              {pending}
            </T>
          </View>
        ) : null}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center', zIndex: 50 },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.ink,
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
    borderRadius: 999,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.saffron },
  count: { marginLeft: 4, backgroundColor: colors.saffron, borderRadius: 999, paddingHorizontal: 7, paddingVertical: 1 },
});
