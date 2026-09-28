import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import React, { useRef, useState } from 'react';
import { ScrollView, StyleSheet, View, useWindowDimensions, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { LanguagePicker } from '@/components/LanguagePicker';
import { Button, T } from '@/components/ui';
import { useI18n } from '@/providers/I18nProvider';
import { prefSet } from '@/services/storage';
import { colors, gradients, radii, spacing } from '@/theme';

/** Three-slide intro with the language picker up front: the mela is multilingual first. */
export default function Onboarding() {
  const { t } = useI18n();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [page, setPage] = useState(0);
  const ref = useRef<ScrollView>(null);

  const slides = [
    { title: t('onboard1Title'), body: t('onboard1Body'), art: <ArtSignal /> },
    { title: t('onboard2Title'), body: t('onboard2Body'), art: <ArtReceipt /> },
    { title: t('onboard3Title'), body: t('onboard3Body'), art: <ArtCrowd /> },
  ];

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => setPage(Math.round(e.nativeEvent.contentOffset.x / width));
  const finish = async () => {
    await prefSet('onboarded', 'true');
    router.replace('/(auth)/login');
  };

  return (
    <LinearGradient colors={[...gradients.sunrise]} style={{ flex: 1 }}>
      <View style={{ paddingTop: insets.top + spacing.lg, paddingHorizontal: spacing.xl, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <T variant="title" tone="saffron">
          Free Pay
        </T>
        <Button title={t('skip')} variant="ghost" size="sm" onPress={finish} />
      </View>

      <View style={{ paddingHorizontal: spacing.xl, marginTop: spacing.lg }}>
        <T variant="label" style={{ marginBottom: spacing.sm }}>
          {t('chooseLanguage')}
        </T>
        <LanguagePicker compact />
      </View>

      <ScrollView ref={ref} horizontal pagingEnabled showsHorizontalScrollIndicator={false} onMomentumScrollEnd={onScroll} style={{ flex: 1, marginTop: spacing.lg }}>
        {slides.map((s, i) => (
          <View key={i} style={{ width, paddingHorizontal: spacing.xl, alignItems: 'center', justifyContent: 'center' }}>
            <View style={styles.art}>{s.art}</View>
            <T variant="display" align="center" style={{ marginTop: spacing.xxl }}>
              {s.title}
            </T>
            <T variant="body" align="center" style={{ marginTop: spacing.md, maxWidth: 320 }}>
              {s.body}
            </T>
          </View>
        ))}
      </ScrollView>

      <View style={{ paddingHorizontal: spacing.xl, paddingBottom: insets.bottom + spacing.xl, gap: spacing.lg }}>
        <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 8 }}>
          {slides.map((_, i) => (
            <View key={i} style={[styles.dot, i === page && styles.dotActive]} />
          ))}
        </View>
        <Button
          title={page === slides.length - 1 ? t('getStarted') : t('next')}
          fullWidth
          size="lg"
          iconRight="arrow-forward"
          onPress={() => (page === slides.length - 1 ? void finish() : ref.current?.scrollTo({ x: (page + 1) * width, animated: true }))}
        />
      </View>
    </LinearGradient>
  );
}

function ArtSignal() {
  return (
    <Svg width={220} height={200} viewBox="0 0 220 200">
      <Rect x={70} y={30} width={80} height={150} rx={16} fill={colors.ink} />
      <Rect x={78} y={44} width={64} height={110} rx={8} fill={colors.card} />
      <Rect x={92} y={62} width={36} height={36} rx={4} fill={colors.ink} />
      <Rect x={98} y={68} width={8} height={8} fill={colors.card} />
      <Rect x={114} y={68} width={8} height={8} fill={colors.card} />
      <Rect x={98} y={84} width={8} height={8} fill={colors.card} />
      <Rect x={112} y={82} width={12} height={12} fill={colors.saffron} />
      <Rect x={90} y={112} width={40} height={6} rx={3} fill={colors.saffron} />
      <Rect x={90} y={124} width={26} height={6} rx={3} fill={colors.border} />
      <Path d="M30 60 q20 -30 40 0" stroke={colors.faint} strokeWidth={5} fill="none" strokeLinecap="round" strokeDasharray="6 8" />
      <Path d="M150 60 q20 -30 40 0" stroke={colors.faint} strokeWidth={5} fill="none" strokeLinecap="round" strokeDasharray="6 8" />
      <Path d="M40 40 L60 20 M60 40 L40 20" stroke={colors.danger} strokeWidth={5} strokeLinecap="round" />
      <Circle cx={110} cy={168} r={5} fill={colors.card} />
    </Svg>
  );
}

function ArtReceipt() {
  return (
    <Svg width={220} height={200} viewBox="0 0 220 200">
      <Path d="M60 20 h100 v150 l-10 -8 l-10 8 l-10 -8 l-10 8 l-10 -8 l-10 8 l-10 -8 l-10 8 l-10 -8 l-10 8 z" fill={colors.card} stroke={colors.border} strokeWidth={2} />
      <Rect x={75} y={38} width={70} height={8} rx={4} fill={colors.saffron} />
      <Rect x={75} y={56} width={50} height={6} rx={3} fill={colors.border} />
      <Rect x={75} y={70} width={60} height={6} rx={3} fill={colors.border} />
      <Rect x={75} y={84} width={40} height={6} rx={3} fill={colors.border} />
      <Rect x={75} y={104} width={70} height={1.5} fill={colors.borderStrong} />
      <Rect x={75} y={116} width={70} height={14} rx={4} fill={colors.ink} />
      <Circle cx={160} cy={150} r={26} fill={colors.success} />
      <Path d="M148 150 l8 8 l16 -18" stroke={colors.white} strokeWidth={5} fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

function ArtCrowd() {
  return (
    <Svg width={220} height={200} viewBox="0 0 220 200">
      <Circle cx={60} cy={70} r={40} fill={colors.densityLow} opacity={0.35} />
      <Circle cx={150} cy={90} r={52} fill={colors.densityCritical} opacity={0.3} />
      <Circle cx={100} cy={150} r={34} fill={colors.densityModerate} opacity={0.35} />
      <Circle cx={60} cy={70} r={14} fill={colors.densityLow} />
      <Circle cx={150} cy={90} r={18} fill={colors.densityCritical} />
      <Circle cx={100} cy={150} r={12} fill={colors.densityModerate} />
      <Path d="M60 70 Q 40 120 100 150" stroke={colors.success} strokeWidth={6} fill="none" strokeLinecap="round" />
      <Path d="M60 70 L150 90" stroke={colors.faint} strokeWidth={4} fill="none" strokeDasharray="6 8" />
      <Circle cx={190} cy={40} r={20} fill={colors.danger} />
      <Path d="M190 30 v12 M190 48 v2" stroke={colors.white} strokeWidth={4} strokeLinecap="round" />
    </Svg>
  );
}

const styles = StyleSheet.create({
  art: { width: 240, height: 220, borderRadius: radii.xl, backgroundColor: 'rgba(255,255,255,0.5)', alignItems: 'center', justifyContent: 'center' },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.borderStrong },
  dotActive: { width: 24, backgroundColor: colors.saffron },
});
