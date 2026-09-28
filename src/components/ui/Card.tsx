import { LinearGradient } from 'expo-linear-gradient';
import React from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { colors, gradients, radii, shadows, spacing } from '../../theme';

export type CardTone = 'default' | 'alt' | 'saffron' | 'ink' | 'success' | 'warning' | 'danger' | 'info' | 'outline';

export interface CardProps {
  tone?: CardTone;
  padding?: number;
  style?: StyleProp<ViewStyle>;
  onPress?: () => void;
  children: React.ReactNode;
  elevated?: boolean;
}

/** Surface primitive. `saffron` and `ink` tones render a gradient for hero cards. */
export function Card({ tone = 'default', padding = spacing.lg, style, onPress, children, elevated = true }: CardProps) {
  const bg: Record<Exclude<CardTone, 'saffron' | 'ink'>, string> = {
    default: colors.card,
    alt: colors.cardAlt,
    success: colors.successSoft,
    warning: colors.warningSoft,
    danger: colors.dangerSoft,
    info: colors.infoSoft,
    outline: 'transparent',
  };
  const body =
    tone === 'saffron' || tone === 'ink' ? (
      <LinearGradient colors={[...(tone === 'saffron' ? gradients.saffron : gradients.ink)]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[styles.card, { padding }]}>
        {children}
      </LinearGradient>
    ) : (
      <View style={[styles.card, { padding, backgroundColor: bg[tone] }, tone === 'outline' && styles.outline, tone === 'default' && styles.hairline]}>{children}</View>
    );

  const wrapperStyle = [styles.wrapper, elevated && tone !== 'outline' && shadows.card, style];
  if (onPress) {
    return (
      <Pressable onPress={onPress} style={({ pressed }) => [wrapperStyle, pressed && { transform: [{ scale: 0.99 }], opacity: 0.96 }]}>
        {body}
      </Pressable>
    );
  }
  return <View style={wrapperStyle}>{body}</View>;
}

const styles = StyleSheet.create({
  wrapper: { borderRadius: radii.lg },
  card: { borderRadius: radii.lg, overflow: 'hidden' },
  hairline: { borderWidth: 1, borderColor: colors.hairline },
  outline: { borderWidth: 1.5, borderColor: colors.border, borderStyle: 'dashed' },
});
