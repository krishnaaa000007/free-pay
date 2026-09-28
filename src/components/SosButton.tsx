import * as Haptics from 'expo-haptics';
import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { colors, shadows } from '../theme';
import { Icon, T } from './ui';

/**
 * Hold-to-trigger SOS. A 2-second hold fills a progress ring; releasing early cancels.
 * Deliberately impossible to fire by accident in a jostling crowd.
 */
const SIZE = 168;
const STROKE = 10;
const R = (SIZE - STROKE) / 2;
const CIRC = 2 * Math.PI * R;
const AnimatedCircle = Animated.createAnimatedComponent(Circle);

export function SosButton({ onTrigger, holdMs = 2000, label = 'Hold for SOS', disabled }: { onTrigger: () => void; holdMs?: number; label?: string; disabled?: boolean }) {
  const progress = useRef(new Animated.Value(0)).current;
  const breathe = useRef(new Animated.Value(0)).current;
  const [holding, setHolding] = useState(false);
  const fired = useRef(false);
  const anim = useRef<Animated.CompositeAnimation | null>(null);

  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([Animated.timing(breathe, { toValue: 1, duration: 1600, easing: Easing.inOut(Easing.quad), useNativeDriver: true }), Animated.timing(breathe, { toValue: 0, duration: 1600, easing: Easing.inOut(Easing.quad), useNativeDriver: true })]));
    loop.start();
    return () => loop.stop();
  }, [breathe]);

  const start = () => {
    if (disabled) return;
    fired.current = false;
    setHolding(true);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
    anim.current = Animated.timing(progress, { toValue: 1, duration: holdMs, easing: Easing.linear, useNativeDriver: false });
    anim.current.start(({ finished }) => {
      if (finished && !fired.current) {
        fired.current = true;
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => undefined);
        onTrigger();
        setHolding(false);
        progress.setValue(0);
      }
    });
  };
  const cancel = () => {
    anim.current?.stop();
    setHolding(false);
    Animated.timing(progress, { toValue: 0, duration: 200, useNativeDriver: false }).start();
  };

  const dashOffset = Animated.multiply(Animated.subtract(1, progress), CIRC);

  return (
    <View style={styles.wrap}>
      <Animated.View style={[styles.glow, { opacity: Animated.add(0.25, Animated.multiply(breathe, 0.35)), transform: [{ scale: Animated.add(1, Animated.multiply(breathe, 0.12)) }] }]} />
      <Pressable onPressIn={start} onPressOut={cancel} disabled={disabled} accessibilityRole="button" accessibilityLabel={label} style={[styles.button, shadows.float, disabled && { opacity: 0.5 }]}>
        <Svg width={SIZE} height={SIZE} style={StyleSheet.absoluteFill}>
          <Circle cx={SIZE / 2} cy={SIZE / 2} r={R} stroke="rgba(255,255,255,0.25)" strokeWidth={STROKE} fill="none" />
          <AnimatedCircle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={R}
            stroke={colors.white}
            strokeWidth={STROKE}
            fill="none"
            strokeDasharray={`${CIRC} ${CIRC}`}
            strokeDashoffset={dashOffset}
            strokeLinecap="round"
            rotation={-90}
            origin={`${SIZE / 2}, ${SIZE / 2}`}
          />
        </Svg>
        <Icon name="alert" size={40} color={colors.white} />
        <T variant="heading" style={{ color: colors.white, letterSpacing: 2, marginTop: 2 }}>
          SOS
        </T>
      </Pressable>
      <T variant="caption" align="center" style={{ marginTop: 14 }}>
        {holding ? 'Keep holding…' : label}
      </T>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center', paddingVertical: 12 },
  glow: { position: 'absolute', top: 12, width: SIZE + 40, height: SIZE + 40, borderRadius: (SIZE + 40) / 2, backgroundColor: colors.danger },
  button: { width: SIZE, height: SIZE, borderRadius: SIZE / 2, backgroundColor: colors.danger, alignItems: 'center', justifyContent: 'center' },
});
