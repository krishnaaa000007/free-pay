import { Platform, type TextStyle, type ViewStyle } from 'react-native';
import { colors, gradients, statusColor } from './colors';

export { colors, gradients, statusColor };

/** 4pt spacing scale. */
export const spacing = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
  huge: 48,
} as const;

export const radii = {
  xs: 6,
  sm: 10,
  md: 14,
  lg: 20,
  xl: 28,
  pill: 999,
} as const;

/**
 * Editorial serif for display text gives the warm, festival-poster feel; the system
 * sans keeps body copy crisp in every Indic script.
 */
export const fonts = {
  display: Platform.select({ ios: 'Georgia', android: 'serif', default: 'Georgia' }) as string,
  displayItalic: Platform.select({ ios: 'Georgia-Italic', android: 'serif', default: 'Georgia' }) as string,
  body: Platform.select({ ios: 'System', android: 'sans-serif', default: 'System' }) as string,
  bodyMedium: Platform.select({ ios: 'System', android: 'sans-serif-medium', default: 'System' }) as string,
  mono: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }) as string,
};

export const typography: Record<string, TextStyle> = {
  hero: { fontFamily: fonts.display, fontSize: 40, lineHeight: 46, color: colors.ink, letterSpacing: -0.5 },
  display: { fontFamily: fonts.display, fontSize: 30, lineHeight: 36, color: colors.ink, letterSpacing: -0.3 },
  title: { fontFamily: fonts.display, fontSize: 22, lineHeight: 28, color: colors.ink },
  heading: { fontFamily: fonts.bodyMedium, fontWeight: '600', fontSize: 17, lineHeight: 22, color: colors.ink },
  body: { fontFamily: fonts.body, fontSize: 15, lineHeight: 21, color: colors.inkSoft },
  bodyStrong: { fontFamily: fonts.bodyMedium, fontWeight: '600', fontSize: 15, lineHeight: 21, color: colors.ink },
  caption: { fontFamily: fonts.body, fontSize: 13, lineHeight: 18, color: colors.muted },
  label: { fontFamily: fonts.bodyMedium, fontWeight: '600', fontSize: 12, lineHeight: 16, color: colors.muted, letterSpacing: 0.6, textTransform: 'uppercase' },
  mono: { fontFamily: fonts.mono, fontSize: 12, lineHeight: 16, color: colors.inkSoft },
  amount: { fontFamily: fonts.display, fontSize: 44, lineHeight: 50, color: colors.ink, letterSpacing: -1 },
};

export const shadows: Record<'card' | 'raised' | 'float', ViewStyle> = {
  card: {
    shadowColor: '#5A3A1A',
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  raised: {
    shadowColor: '#5A3A1A',
    shadowOpacity: 0.14,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 5,
  },
  float: {
    shadowColor: '#3A2410',
    shadowOpacity: 0.22,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 10,
  },
};

export const layout = {
  screenPadding: spacing.xl,
  maxContentWidth: 560,
  tabBarHeight: 74,
} as const;

export const theme = { colors, gradients, spacing, radii, fonts, typography, shadows, layout, statusColor };
export type Theme = typeof theme;
