import React from 'react';
import { Text as RNText, type StyleProp, type TextProps, type TextStyle } from 'react-native';
import { colors, typography } from '../../theme';

export type TextVariant = 'hero' | 'display' | 'title' | 'heading' | 'body' | 'bodyStrong' | 'caption' | 'label' | 'mono' | 'amount';
export type TextTone = 'ink' | 'soft' | 'muted' | 'faint' | 'saffron' | 'success' | 'warning' | 'danger' | 'info' | 'onSaffron' | 'onDark' | 'white';

const toneColor: Record<TextTone, string> = {
  ink: colors.ink,
  soft: colors.inkSoft,
  muted: colors.muted,
  faint: colors.faint,
  saffron: colors.saffronDeep,
  success: colors.success,
  warning: colors.warning,
  danger: colors.danger,
  info: colors.info,
  onSaffron: colors.onSaffron,
  onDark: colors.onDark,
  white: colors.white,
};

export interface TProps extends TextProps {
  variant?: TextVariant;
  tone?: TextTone;
  align?: TextStyle['textAlign'];
  weight?: TextStyle['fontWeight'];
  style?: StyleProp<TextStyle>;
  children?: React.ReactNode;
}

/** The one text component. Variants come from the theme; tone overrides colour. */
export function T({ variant = 'body', tone, align, weight, style, children, ...rest }: TProps) {
  return (
    <RNText
      {...rest}
      style={[typography[variant], tone ? { color: toneColor[tone] } : null, align ? { textAlign: align } : null, weight ? { fontWeight: weight } : null, style]}
      maxFontSizeMultiplier={1.3}
    >
      {children}
    </RNText>
  );
}
