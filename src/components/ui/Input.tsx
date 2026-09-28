import React, { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View, type StyleProp, type TextInputProps, type ViewStyle } from 'react-native';
import { colors, fonts, radii, spacing } from '../../theme';
import { Icon, type IconName } from './Icon';
import { T } from './Text';

export interface InputProps extends TextInputProps {
  label?: string;
  hint?: string;
  error?: string | null;
  icon?: IconName;
  containerStyle?: StyleProp<ViewStyle>;
  secure?: boolean;
}

export function Input({ label, hint, error, icon, containerStyle, secure, style, ...rest }: InputProps) {
  const [focused, setFocused] = useState(false);
  const [hidden, setHidden] = useState(!!secure);
  return (
    <View style={containerStyle}>
      {label ? (
        <T variant="label" style={{ marginBottom: spacing.xs }}>
          {label}
        </T>
      ) : null}
      <View style={[styles.field, focused && styles.focused, !!error && styles.errored]}>
        {icon ? <Icon name={icon} size={18} color={focused ? colors.saffronDeep : colors.muted} /> : null}
        <TextInput
          placeholderTextColor={colors.faint}
          selectionColor={colors.saffron}
          onFocus={(e) => {
            setFocused(true);
            rest.onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            rest.onBlur?.(e);
          }}
          secureTextEntry={hidden}
          {...rest}
          style={[styles.input, style]}
        />
        {secure ? (
          <Pressable onPress={() => setHidden((h) => !h)} hitSlop={8}>
            <Icon name={hidden ? 'eye-outline' : 'eye-off-outline'} size={18} color={colors.muted} />
          </Pressable>
        ) : null}
      </View>
      {error ? (
        <T variant="caption" tone="danger" style={{ marginTop: spacing.xs }}>
          {error}
        </T>
      ) : hint ? (
        <T variant="caption" style={{ marginTop: spacing.xs }}>
          {hint}
        </T>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.card,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    minHeight: 52,
  },
  focused: { borderColor: colors.saffron, backgroundColor: colors.white },
  errored: { borderColor: colors.danger },
  input: { flex: 1, fontFamily: fonts.body, fontSize: 16, color: colors.ink, paddingVertical: spacing.md },
});
