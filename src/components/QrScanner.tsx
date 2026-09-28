import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Platform, StyleSheet, TextInput, View } from 'react-native';
import { useI18n } from '../providers/I18nProvider';
import { colors, radii, spacing } from '../theme';
import { Button, Icon, IconButton, T } from './ui';

export interface QrScannerProps {
  onScan: (raw: string) => void;
  /** Ignore further scans for this long after a hit (ms). */
  cooldownMs?: number;
  hint?: string;
  /** Show a paste box (web / simulators without a camera). */
  allowPaste?: boolean;
  active?: boolean;
  /** Set false to skip the camera entirely (demo stage: the code arrives over the relay). */
  camera?: boolean;
}

/**
 * Camera-based QR scanner with a framed viewfinder, torch toggle and a paste fallback so
 * the flow can be demonstrated on simulators and the web.
 */
export function QrScanner({ onScan, cooldownMs = 1800, hint, allowPaste = true, active = true, camera = true }: QrScannerProps) {
  const { t } = useI18n();
  const [permission, requestPermission] = useCameraPermissions();
  const [torch, setTorch] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasted, setPasted] = useState('');
  const lastHit = useRef(0);
  const scanLine = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(scanLine, { toValue: 1, duration: 1800, useNativeDriver: true }),
        Animated.timing(scanLine, { toValue: 0, duration: 1800, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [scanLine]);

  const handle = useCallback(
    (result: BarcodeScanningResult) => {
      const now = Date.now();
      if (now - lastHit.current < cooldownMs) return;
      lastHit.current = now;
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
      onScan(result.data);
    },
    [cooldownMs, onScan],
  );

  const cameraOk = camera && !!permission?.granted;

  // If the camera is off, unavailable or refused, surface the paste fallback automatically.
  useEffect(() => {
    if (!camera || (permission && !permission.granted)) setPasteOpen(true);
  }, [camera, permission]);

  return (
    <View style={styles.root}>
      {cameraOk && active ? (
        <CameraView
          style={StyleSheet.absoluteFill}
          facing="back"
          enableTorch={torch}
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          onBarcodeScanned={handle}
        />
      ) : (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: '#1B120C' }]} />
      )}

      {/* Dim mask with a clear window */}
      <View style={styles.maskTop} />
      <View style={styles.maskRow}>
        <View style={styles.maskSide} />
        <View style={styles.window}>
          <Corner style={{ top: -2, left: -2, borderTopWidth: 4, borderLeftWidth: 4, borderTopLeftRadius: radii.lg }} />
          <Corner style={{ top: -2, right: -2, borderTopWidth: 4, borderRightWidth: 4, borderTopRightRadius: radii.lg }} />
          <Corner style={{ bottom: -2, left: -2, borderBottomWidth: 4, borderLeftWidth: 4, borderBottomLeftRadius: radii.lg }} />
          <Corner style={{ bottom: -2, right: -2, borderBottomWidth: 4, borderRightWidth: 4, borderBottomRightRadius: radii.lg }} />
          <Animated.View style={[styles.scanLine, { transform: [{ translateY: Animated.multiply(scanLine, 240) }] }]} />
        </View>
        <View style={styles.maskSide} />
      </View>
      <View style={styles.maskBottom}>
        <T variant="body" style={{ color: colors.onDark, textAlign: 'center', opacity: 0.9 }}>
          {hint ?? t('alignQr')}
        </T>

        {camera && !permission?.granted ? (
          <View style={{ alignItems: 'center', gap: spacing.sm, marginTop: spacing.md }}>
            <T variant="caption" style={{ color: colors.onDark, opacity: 0.75, textAlign: 'center' }}>
              {t('cameraDenied')}
            </T>
            <Button title={t('grantCamera')} icon="camera-outline" onPress={() => void requestPermission()} size="sm" />
          </View>
        ) : null}

        <View style={styles.tools}>
          {cameraOk && Platform.OS !== 'web' ? <IconButton icon={torch ? 'flash' : 'flash-outline'} tone={torch ? 'saffron' : 'ink'} onPress={() => setTorch((v) => !v)} label={t('torch')} /> : null}
          {allowPaste ? <IconButton icon="clipboard-outline" tone={pasteOpen ? 'saffron' : 'ink'} onPress={() => setPasteOpen((v) => !v)} label={t('pasteCode')} /> : null}
        </View>

        {pasteOpen ? (
          <View style={styles.pasteBox}>
            <TextInput
              value={pasted}
              onChangeText={setPasted}
              placeholder={t('pasteCode')}
              placeholderTextColor={colors.faint}
              style={styles.pasteInput}
              multiline
              numberOfLines={3}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <Button
              title={t('scan')}
              size="sm"
              icon="qr-code-outline"
              disabled={!pasted.trim()}
              onPress={() => {
                onScan(pasted.trim());
                setPasted('');
              }}
            />
          </View>
        ) : null}
      </View>

      <View style={styles.badge}>
        <Icon name="shield-checkmark" size={14} color={colors.onDark} />
        <T variant="caption" style={{ color: colors.onDark, fontWeight: '600' }}>
          {t('verifiedOffline')}
        </T>
      </View>
    </View>
  );
}

function Corner({ style }: { style: object }) {
  return <View style={[styles.corner, style]} />;
}

const WINDOW = 260;
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#1B120C' },
  maskTop: { flex: 1, backgroundColor: 'rgba(27,18,12,0.55)' },
  maskRow: { flexDirection: 'row', height: WINDOW },
  maskSide: { flex: 1, backgroundColor: 'rgba(27,18,12,0.55)' },
  window: { width: WINDOW, height: WINDOW, position: 'relative', overflow: 'hidden' },
  corner: { position: 'absolute', width: 34, height: 34, borderColor: colors.saffron },
  scanLine: { position: 'absolute', left: 12, right: 12, top: 8, height: 2, backgroundColor: colors.saffron, opacity: 0.85, borderRadius: 1, shadowColor: colors.saffron, shadowOpacity: 0.9, shadowRadius: 6 },
  maskBottom: { flex: 1.4, backgroundColor: 'rgba(27,18,12,0.55)', paddingHorizontal: spacing.xl, paddingTop: spacing.lg, alignItems: 'center' },
  tools: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.lg },
  pasteBox: { marginTop: spacing.md, width: '100%', gap: spacing.sm, alignItems: 'flex-end' },
  pasteInput: { width: '100%', minHeight: 64, backgroundColor: colors.card, borderRadius: radii.md, padding: spacing.md, color: colors.ink, fontSize: 12 },
  badge: { position: 'absolute', top: spacing.md, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(43,29,20,0.7)', paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: 999 },
});
