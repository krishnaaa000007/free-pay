import * as Haptics from 'expo-haptics';
import React, { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { dismiss, expire, subscribe, type AppNotification, type NotificationKind } from '../services/notifications';
import { colors, radii, shadows, spacing } from '../theme';
import { Icon, T, type IconName } from './ui';

const kindStyle: Record<NotificationKind, { icon: IconName; accent: string; bg: string }> = {
  success: { icon: 'checkmark-circle', accent: colors.success, bg: colors.card },
  info: { icon: 'information-circle', accent: colors.info, bg: colors.card },
  warning: { icon: 'alert-circle', accent: colors.warning, bg: colors.card },
  error: { icon: 'close-circle', accent: colors.danger, bg: colors.card },
  sync: { icon: 'cloud-done', accent: colors.saffronDeep, bg: colors.card },
};

/** Renders the in-app notification queue as stacked toasts at the top of the screen. */
export function NotificationToaster() {
  const [queue, setQueue] = useState<AppNotification[]>([]);
  const insets = useSafeAreaInsets();
  const seen = useRef(new Set<string>());

  useEffect(() => {
    const unsub = subscribe((q) => {
      setQueue([...q]);
      for (const n of q) {
        if (!seen.current.has(n.id)) {
          seen.current.add(n.id);
          const style = n.kind === 'error' ? Haptics.NotificationFeedbackType.Error : n.kind === 'warning' ? Haptics.NotificationFeedbackType.Warning : Haptics.NotificationFeedbackType.Success;
          void Haptics.notificationAsync(style).catch(() => undefined);
        }
      }
    });
    const timer = setInterval(() => expire(), 500);
    return () => {
      unsub();
      clearInterval(timer);
    };
  }, []);

  if (queue.length === 0) return null;
  return (
    <View pointerEvents="box-none" style={[styles.wrap, { top: insets.top + 44 }]}>
      {queue.map((n, i) => (
        <Toast key={n.id} n={n} index={i} />
      ))}
    </View>
  );
}

function Toast({ n, index }: { n: AppNotification; index: number }) {
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.spring(anim, { toValue: 1, useNativeDriver: true, friction: 8, tension: 70 }).start();
  }, [anim]);
  const s = kindStyle[n.kind];
  return (
    <Animated.View style={[styles.toast, shadows.raised, { backgroundColor: s.bg, opacity: anim, transform: [{ translateY: Animated.multiply(Animated.subtract(1, anim), -20) }, { scale: Animated.add(0.96, Animated.multiply(anim, 0.04)) }], marginTop: index === 0 ? 0 : spacing.sm }]}>
      <View style={[styles.accent, { backgroundColor: s.accent }]} />
      <Icon name={s.icon} size={22} color={s.accent} />
      <View style={{ flex: 1 }}>
        <T variant="bodyStrong" numberOfLines={1}>
          {n.title}
        </T>
        {n.message ? (
          <T variant="caption" numberOfLines={2}>
            {n.message}
          </T>
        ) : null}
      </View>
      {n.action ? (
        <Pressable
          onPress={() => {
            n.action?.onPress();
            dismiss(n.id);
          }}
          hitSlop={8}
        >
          <T variant="caption" tone="saffron" weight="700">
            {n.action.label}
          </T>
        </Pressable>
      ) : null}
      <Pressable onPress={() => dismiss(n.id)} hitSlop={10} accessibilityLabel="Dismiss">
        <Icon name="close" size={16} color={colors.faint} />
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: spacing.lg, right: spacing.lg, zIndex: 100 },
  toast: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, paddingLeft: spacing.lg, borderRadius: radii.lg, overflow: 'hidden' },
  accent: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 4 },
});
