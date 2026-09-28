import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import type { Tabs } from 'expo-router';
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, gradients, layout, radii, shadows, spacing } from '../theme';
import { Icon, T, type IconName } from './ui';

/** Props expo-router hands to a custom tabBar (avoids a direct @react-navigation dependency). */
export type BottomTabBarProps = Parameters<NonNullable<React.ComponentProps<typeof Tabs>['tabBar']>>[0];

export interface TabSpec {
  name: string;
  label: string;
  icon: IconName;
  iconActive: IconName;
  /** Renders as the raised saffron action button in the centre. */
  hero?: boolean;
  badge?: number;
}

/**
 * Floating parchment tab bar with a raised saffron "hero" action in the middle (Scan for
 * pilgrims, Accept payment for vendors). Used by both role layouts.
 */
export function FloatingTabBar({ state, navigation, tabs }: BottomTabBarProps & { tabs: TabSpec[] }) {
  const insets = useSafeAreaInsets();
  const bottom = Math.max(insets.bottom, spacing.md);

  return (
    <View pointerEvents="box-none" style={[styles.wrap, { paddingBottom: bottom }]}>
      <View style={[styles.bar, shadows.raised]}>
        {state.routes.map((route, index) => {
          const spec = tabs.find((t) => t.name === route.name);
          if (!spec) return null;
          const focused = state.index === index;
          const onPress = () => {
            void Haptics.selectionAsync().catch(() => undefined);
            const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
            if (!focused && !event.defaultPrevented) navigation.navigate(route.name);
          };
          if (spec.hero) {
            return (
              <Pressable key={route.key} onPress={onPress} accessibilityRole="button" accessibilityLabel={spec.label} style={styles.heroWrap}>
                <LinearGradient colors={[...gradients.saffron]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[styles.hero, shadows.float]}>
                  <Icon name={focused ? spec.iconActive : spec.icon} size={28} color={colors.onSaffron} />
                </LinearGradient>
                <T variant="caption" style={[styles.label, { color: focused ? colors.saffronDeep : colors.muted }]}>
                  {spec.label}
                </T>
              </Pressable>
            );
          }
          return (
            <Pressable key={route.key} onPress={onPress} accessibilityRole="tab" accessibilityState={{ selected: focused }} style={styles.tab}>
              <View style={[styles.iconWrap, focused && styles.iconWrapActive]}>
                <Icon name={focused ? spec.iconActive : spec.icon} size={22} color={focused ? colors.saffronDeep : colors.muted} />
                {spec.badge ? (
                  <View style={styles.badge}>
                    <T style={styles.badgeText}>{spec.badge > 99 ? '99+' : spec.badge}</T>
                  </View>
                ) : null}
              </View>
              <T variant="caption" style={[styles.label, { color: focused ? colors.saffronDeep : colors.muted, fontWeight: focused ? '700' : '500' }]}>
                {spec.label}
              </T>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/** Pilgrim-specific wrapper kept for readability at the layout call-site. */
export function PilgrimTabBar(props: BottomTabBarProps & { tabs: TabSpec[] }) {
  return <FloatingTabBar {...props} />;
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: spacing.lg, alignItems: 'center' },
  bar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-around',
    width: '100%',
    maxWidth: layout.maxContentWidth,
    height: layout.tabBarHeight,
    backgroundColor: colors.card,
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: colors.hairline,
    paddingHorizontal: spacing.xs,
    paddingBottom: spacing.sm,
  },
  tab: { flex: 1, alignItems: 'center', justifyContent: 'flex-end', gap: 3, paddingTop: spacing.sm },
  iconWrap: { width: 44, height: 30, borderRadius: radii.pill, alignItems: 'center', justifyContent: 'center' },
  iconWrapActive: { backgroundColor: colors.saffronSoft },
  label: { fontSize: 11, lineHeight: 13 },
  heroWrap: { flex: 1, alignItems: 'center', justifyContent: 'flex-end', gap: 4 },
  hero: { width: 58, height: 58, borderRadius: 29, alignItems: 'center', justifyContent: 'center', marginTop: -26, borderWidth: 4, borderColor: colors.parchment },
  badge: { position: 'absolute', top: -2, right: 2, minWidth: 16, height: 16, borderRadius: 8, backgroundColor: colors.vermilion, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  badgeText: { color: colors.white, fontSize: 10, lineHeight: 12, fontWeight: '700' },
});
