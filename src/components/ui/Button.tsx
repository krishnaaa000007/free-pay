import { LinearGradient } from 'expo-linear-gradient';
import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';
import { colors, gradients, radii, shadows, spacing } from '../../theme';
import { Icon, type IconName } from './Icon';
import { T } from './Text';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success' | 'ink';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends Omit<PressableProps, 'style' | 'children'> {
  title: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: IconName;
  iconRight?: IconName;
  loading?: boolean;
  fullWidth?: boolean;
  style?: StyleProp<ViewStyle>;
}

const heights: Record<ButtonSize, number> = { sm: 38, md: 50, lg: 58 };
const fontSizes: Record<ButtonSize, number> = { sm: 14, md: 16, lg: 17 };

export function Button({ title, variant = 'primary', size = 'md', icon, iconRight, loading, fullWidth, disabled, style, ...rest }: ButtonProps) {
  const isGradient = variant === 'primary' || variant === 'danger' || variant === 'success' || variant === 'ink';
  const textColor =
    variant === 'secondary' ? colors.ink : variant === 'ghost' ? colors.saffronDeep : colors.onSaffron;
  const gradient =
    variant === 'danger' ? gradients.dusk : variant === 'success' ? gradients.success : variant === 'ink' ? gradients.ink : gradients.saffron;
  const inactive = disabled || loading;

  const content = (
    <View style={[styles.row, { height: heights[size] }]}>
      {loading ? (
        <ActivityIndicator color={textColor} />
      ) : (
        <>
          {icon ? <Icon name={icon} size={fontSizes[size] + 3} color={textColor} /> : null}
          <T variant="bodyStrong" style={{ color: textColor, fontSize: fontSizes[size], lineHeight: fontSizes[size] + 6 }}>
            {title}
          </T>
          {iconRight ? <Icon name={iconRight} size={fontSizes[size] + 3} color={textColor} /> : null}
        </>
      )}
    </View>
  );

  return (
    <Pressable
      accessibilityRole="button"
      disabled={inactive}
      {...rest}
      style={({ pressed }) => [
        styles.base,
        fullWidth && styles.fullWidth,
        variant === 'secondary' && styles.secondary,
        variant === 'ghost' && styles.ghost,
        isGradient && shadows.card,
        pressed && !inactive && { transform: [{ scale: 0.985 }], opacity: 0.94 },
        inactive && { opacity: 0.55 },
        style,
      ]}
    >
      {isGradient ? (
        <LinearGradient colors={[...gradient]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.gradient}>
          {content}
        </LinearGradient>
      ) : (
        content
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { borderRadius: radii.md, overflow: 'hidden', alignSelf: 'flex-start' },
  fullWidth: { alignSelf: 'stretch' },
  gradient: { borderRadius: radii.md },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, paddingHorizontal: spacing.xl },
  secondary: { backgroundColor: colors.card, borderWidth: 1.5, borderColor: colors.borderStrong },
  ghost: { backgroundColor: 'transparent' },
});
