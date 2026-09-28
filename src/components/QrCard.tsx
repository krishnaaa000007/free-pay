import React from 'react';
import { StyleSheet, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { payloadSizeLabel, qrErrorLevel } from '../services/qr';
import { colors, radii, shadows, spacing } from '../theme';
import { Icon, T } from './ui';

/**
 * Framed QR display used for payment codes, stall codes and receipts. The frame is
 * high-contrast (pure white on ink) because mela lighting is harsh and scanners are cheap.
 */
export function QrCard({ value, size = 232, caption, footer, badge }: { value: string; size?: number; caption?: string; footer?: React.ReactNode; badge?: string }) {
  return (
    <View style={[styles.card, shadows.raised]}>
      {badge ? (
        <View style={styles.badge}>
          <Icon name="shield-checkmark" size={12} color={colors.onSaffron} />
          <T variant="caption" style={{ color: colors.onSaffron, fontWeight: '700', fontSize: 11 }}>
            {badge}
          </T>
        </View>
      ) : null}
      <View style={styles.qrWrap}>
        <QRCode value={value} size={size} ecl={qrErrorLevel(value)} color={colors.ink} backgroundColor={colors.white} quietZone={8} />
      </View>
      {caption ? (
        <T variant="caption" align="center" style={{ marginTop: spacing.md }}>
          {caption}
        </T>
      ) : null}
      <T variant="mono" align="center" style={{ marginTop: spacing.xs, color: colors.faint }}>
        {payloadSizeLabel(value)} · ECL {qrErrorLevel(value)}
      </T>
      {footer}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.card, borderRadius: radii.xl, padding: spacing.xl, alignItems: 'center', borderWidth: 1, borderColor: colors.hairline },
  qrWrap: { backgroundColor: colors.white, borderRadius: radii.lg, padding: spacing.sm, borderWidth: 4, borderColor: colors.ink },
  badge: { position: 'absolute', top: -12, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.saffron, paddingHorizontal: spacing.md, paddingVertical: 4, borderRadius: radii.pill, zIndex: 2 },
});
