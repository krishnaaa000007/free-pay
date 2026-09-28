import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React from 'react';
import { KeyboardAvoidingView, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, layout, spacing } from '../../theme';
import { Icon, type IconName } from './Icon';
import { T } from './Text';

export interface ScreenProps {
  children?: React.ReactNode;
  /** Scrollable (default) or a plain flex container for full-bleed screens (camera, map). */
  scroll?: boolean;
  padded?: boolean;
  title?: string;
  subtitle?: string;
  back?: boolean;
  onBack?: () => void;
  right?: React.ReactNode;
  headerTone?: 'light' | 'dark';
  background?: string;
  refreshing?: boolean;
  onRefresh?: () => void;
  style?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
  /** Extra bottom padding, e.g. when a floating tab bar overlaps the content. */
  bottomInset?: number;
  keyboard?: boolean;
}

/** Page scaffold: safe areas, parchment background, optional header and pull-to-refresh. */
export function Screen({
  children,
  scroll = true,
  padded = true,
  title,
  subtitle,
  back,
  onBack,
  right,
  headerTone = 'light',
  background = colors.parchment,
  refreshing,
  onRefresh,
  style,
  contentStyle,
  bottomInset = 0,
  keyboard,
}: ScreenProps) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const header =
    title || back || right ? (
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <View style={styles.headerRow}>
          {back ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Back"
              onPress={onBack ?? (() => (router.canGoBack() ? router.back() : router.replace('/')))}
              style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.6 }]}
              hitSlop={8}
            >
              <Icon name="chevron-back" size={22} color={headerTone === 'dark' ? colors.onDark : colors.ink} />
            </Pressable>
          ) : (
            <View style={{ width: 4 }} />
          )}
          <View style={{ flex: 1 }}>
            {title ? (
              <T variant="title" tone={headerTone === 'dark' ? 'onDark' : 'ink'} numberOfLines={1}>
                {title}
              </T>
            ) : null}
            {subtitle ? (
              <T variant="caption" tone={headerTone === 'dark' ? 'onDark' : 'muted'} numberOfLines={2} style={{ opacity: headerTone === 'dark' ? 0.8 : 1 }}>
                {subtitle}
              </T>
            ) : null}
          </View>
          {right ? <View style={styles.right}>{right}</View> : null}
        </View>
      </View>
    ) : null;

  const paddingBottom = insets.bottom + spacing.xl + bottomInset;
  const inner = (
    <View style={[styles.content, padded && { paddingHorizontal: layout.screenPadding }, { paddingBottom }, contentStyle]}>{children}</View>
  );

  const body = scroll ? (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={{ flexGrow: 1 }}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
      refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={colors.saffron} colors={[colors.saffron]} /> : undefined}
    >
      {!header ? <View style={{ height: insets.top + spacing.md }} /> : null}
      {inner}
    </ScrollView>
  ) : (
    <View style={{ flex: 1 }}>
      {!header ? <View style={{ height: insets.top }} /> : null}
      {inner}
    </View>
  );

  return (
    <View style={[styles.root, { backgroundColor: background }, style]}>
      <StatusBar style={headerTone === 'dark' ? 'light' : 'dark'} />
      {header}
      {keyboard ? (
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          {body}
        </KeyboardAvoidingView>
      ) : (
        body
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { paddingHorizontal: spacing.md, paddingBottom: spacing.sm },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, minHeight: 44 },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 20 },
  right: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingRight: spacing.xs },
  content: { flex: 1, width: '100%', maxWidth: layout.maxContentWidth, alignSelf: 'center' },
});
