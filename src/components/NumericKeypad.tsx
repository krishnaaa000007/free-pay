import * as Haptics from 'expo-haptics';
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { colors, fonts, radii, spacing } from '../theme';
import { Icon, T } from './ui';

export interface NumericKeypadProps {
  value: string;
  onChange: (next: string) => void;
  /** Max integer digits before the decimal point. */
  maxDigits?: number;
  allowDecimal?: boolean;
}

const KEYS: Array<string | 'back'> = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', 'back'];

/** Large, thumb-friendly keypad for entering amounts. Emits the raw string; parse with parseAmountInput. */
export function NumericKeypad({ value, onChange, maxDigits = 6, allowDecimal = true }: NumericKeypadProps) {
  const press = (k: string | 'back') => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
    if (k === 'back') return onChange(value.slice(0, -1));
    if (k === '.') {
      if (!allowDecimal || value.includes('.')) return;
      return onChange(value === '' ? '0.' : value + '.');
    }
    const [int, dec] = value.split('.');
    if (value.includes('.')) {
      if ((dec ?? '').length >= 2) return;
      return onChange(value + k);
    }
    if (int === '0') return onChange(k);
    if (int.length >= maxDigits) return;
    onChange(value + k);
  };

  return (
    <View style={styles.grid}>
      {KEYS.map((k) => (
        <Pressable
          key={k}
          accessibilityRole="button"
          accessibilityLabel={k === 'back' ? 'Delete' : k}
          onPress={() => press(k)}
          onLongPress={k === 'back' ? () => onChange('') : undefined}
          style={({ pressed }) => [styles.key, pressed && styles.keyPressed, k === '.' && !allowDecimal && { opacity: 0.3 }]}
        >
          {k === 'back' ? <Icon name="backspace-outline" size={26} color={colors.ink} /> : <T style={styles.keyText}>{k}</T>}
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  key: {
    width: '31.5%',
    flexGrow: 1,
    height: 62,
    borderRadius: radii.md,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.hairline,
  },
  keyPressed: { backgroundColor: colors.saffronSoft, borderColor: colors.saffron },
  keyText: { fontFamily: fonts.display, fontSize: 26, color: colors.ink },
});
