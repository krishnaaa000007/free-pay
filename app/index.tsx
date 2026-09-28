import { Redirect } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { T } from '@/components/ui';
import { useAuth } from '@/providers/AuthProvider';
import { prefGet } from '@/services/storage';
import { colors, spacing } from '@/theme';

/** Entry: route by session + role. Shows a branded hold while storage is read. */
export default function Index() {
  const { status, user } = useAuth();
  const [onboarded, setOnboarded] = useState<boolean | null>(null);

  useEffect(() => {
    prefGet('onboarded').then((v) => setOnboarded(v === 'true'));
  }, []);

  if (status === 'loading' || onboarded === null) {
    return (
      <View style={styles.hold}>
        <T variant="hero" tone="saffron">
          Free Pay
        </T>
        <T variant="caption" style={{ marginTop: spacing.xs }}>
          Payments that work when the network does not
        </T>
        <ActivityIndicator color={colors.saffron} style={{ marginTop: spacing.xxl }} />
      </View>
    );
  }
  if (status === 'signedOut') return <Redirect href={onboarded ? '/(auth)/login' : '/(auth)/onboarding'} />;
  if (user?.role === 'VENDOR') return <Redirect href="/(vendor)/dashboard" />;
  return <Redirect href="/(pilgrim)/home" />;
}

const styles = StyleSheet.create({
  hold: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.parchment },
});
