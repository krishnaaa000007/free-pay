/**
 * Free Pay "parchment" palette.
 * Warm paper surfaces, saffron as the single brand accent, kumkum-red for danger, tulsi
 * green for success. Every colour here has a soft tint sibling for chips and backgrounds.
 */
export const colors = {
  // surfaces
  parchment: '#F7EFE3',
  parchmentDeep: '#EEE2CE',
  card: '#FFFBF4',
  cardAlt: '#FBF3E6',
  border: '#E6D8C3',
  borderStrong: '#D3BFA3',
  hairline: 'rgba(43,29,20,0.08)',

  // brand
  saffron: '#E8891D',
  saffronDeep: '#C96F0F',
  saffronSoft: '#FBE3C6',
  saffronGlow: 'rgba(232,137,29,0.18)',
  vermilion: '#A63A2A',
  vermilionSoft: '#F3D6CF',
  gold: '#C9A227',
  goldSoft: '#F4E7B8',
  indigo: '#3B3F7A',
  indigoSoft: '#DEDFF0',

  // text
  ink: '#2B1D14',
  inkSoft: '#5A4634',
  muted: '#8B7461',
  faint: '#B8A48E',
  onSaffron: '#FFF8EC',
  onDark: '#F7EFE3',

  // status
  success: '#3E7C4A',
  successSoft: '#DCEBD9',
  warning: '#C9861B',
  warningSoft: '#FBE7C2',
  danger: '#B5371F',
  dangerSoft: '#F6D5CD',
  info: '#2F6B8A',
  infoSoft: '#D6E6EE',

  // crowd density scale
  densityLow: '#6FA37A',
  densityModerate: '#E2B33C',
  densityHigh: '#E8891D',
  densityCritical: '#B5371F',

  overlay: 'rgba(43,29,20,0.55)',
  white: '#FFFFFF',
  black: '#000000',
  transparent: 'transparent',
} as const;

export type ColorName = keyof typeof colors;

/** Gradients used by hero headers and primary buttons. */
export const gradients = {
  saffron: ['#F2A044', '#E8891D', '#C96F0F'] as const,
  sunrise: ['#FBE3C6', '#F7EFE3'] as const,
  dusk: ['#A63A2A', '#7A2A1E'] as const,
  ink: ['#4A3628', '#2B1D14'] as const,
  success: ['#5A9A66', '#3E7C4A'] as const,
  parchment: ['#FFFBF4', '#F7EFE3'] as const,
};

export const statusColor = {
  PENDING_SYNC: { fg: colors.warning, bg: colors.warningSoft, label: 'Pending sync' },
  SYNCED: { fg: colors.info, bg: colors.infoSoft, label: 'Synced' },
  SETTLED: { fg: colors.success, bg: colors.successSoft, label: 'Settled' },
  FAILED: { fg: colors.danger, bg: colors.dangerSoft, label: 'Failed' },
} as const;
