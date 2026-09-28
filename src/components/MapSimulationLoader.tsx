import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { useI18n } from '../providers/I18nProvider';
import { colors, spacing } from '../theme';
import { Icon, T } from './ui';

/**
 * Full-card loader shown while crowd data is being fetched/simulated: concentric ripples
 * that read as "sensors sweeping the grounds". Pure Animated, no extra dependencies.
 */
export function MapSimulationLoader({ label }: { label?: string }) {
  const { t } = useI18n();
  const rings = [useRef(new Animated.Value(0)).current, useRef(new Animated.Value(0)).current, useRef(new Animated.Value(0)).current];

  useEffect(() => {
    const loops = rings.map((r, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(i * 600),
          Animated.timing(r, { toValue: 1, duration: 1800, easing: Easing.out(Easing.quad), useNativeDriver: true }),
          Animated.timing(r, { toValue: 0, duration: 0, useNativeDriver: true }),
        ]),
      ),
    );
    loops.forEach((l) => l.start());
    return () => loops.forEach((l) => l.stop());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <View style={styles.root}>
      <View style={styles.center}>
        {rings.map((r, i) => (
          <Animated.View
            key={i}
            style={[
              styles.ring,
              {
                opacity: Animated.subtract(0.6, Animated.multiply(r, 0.6)),
                transform: [{ scale: Animated.add(0.4, Animated.multiply(r, 2.4)) }],
              },
            ]}
          />
        ))}
        <View style={styles.core}>
          <Icon name="radio-outline" size={26} color={colors.onSaffron} />
        </View>
      </View>
      <T variant="bodyStrong" style={{ marginTop: spacing.xl }}>
        {label ?? t('simulating')}
      </T>
      <T variant="caption">{t('crowdSubtitle')}</T>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: 260, backgroundColor: colors.cardAlt, borderRadius: 20 },
  center: { width: 120, height: 120, alignItems: 'center', justifyContent: 'center' },
  ring: { position: 'absolute', width: 60, height: 60, borderRadius: 30, borderWidth: 2, borderColor: colors.saffron },
  core: { width: 56, height: 56, borderRadius: 28, backgroundColor: colors.saffron, alignItems: 'center', justifyContent: 'center' },
});
