import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import type { Language } from '../domain/types';
import { LANGUAGES } from '../i18n';
import { useI18n } from '../providers/I18nProvider';
import { colors, radii, spacing } from '../theme';
import { Icon, T } from './ui';

/** Language chips. Shows the native script so people find their language instantly. */
export function LanguagePicker({ compact, onChange }: { compact?: boolean; onChange?: (lang: Language) => void }) {
  const { language, setLanguage } = useI18n();
  return (
    <View style={[styles.row, compact && { gap: spacing.xs }]}>
      {LANGUAGES.map((l) => {
        const active = l.code === language;
        return (
          <Pressable
            key={l.code}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            onPress={() => {
              void setLanguage(l.code);
              onChange?.(l.code);
            }}
            style={[styles.chip, compact && styles.chipCompact, active && styles.chipActive]}
          >
            <T variant={compact ? 'caption' : 'bodyStrong'} style={{ color: active ? colors.onSaffron : colors.ink }}>
              {l.native}
            </T>
            {!compact ? (
              <T variant="caption" style={{ color: active ? colors.onSaffron : colors.muted, opacity: active ? 0.85 : 1 }}>
                {l.label}
              </T>
            ) : null}
            {active && !compact ? <Icon name="checkmark-circle" size={16} color={colors.onSaffron} /> : null}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm + 2, borderRadius: radii.pill, backgroundColor: colors.card, borderWidth: 1.5, borderColor: colors.border },
  chipCompact: { paddingVertical: 5, paddingHorizontal: spacing.md },
  chipActive: { backgroundColor: colors.saffron, borderColor: colors.saffron },
});
