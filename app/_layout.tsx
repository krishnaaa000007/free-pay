import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import React, { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { AutoSyncManager } from '@/components/AutoSyncManager';
import { NotificationToaster } from '@/components/NotificationToaster';
import { OfflineBanner } from '@/components/OfflineBanner';
import { AppProviders } from '@/providers';
import { ensurePrng } from '@/services/crypto';
import { colors } from '@/theme';

void SplashScreen.preventAutoHideAsync().catch(() => undefined);
ensurePrng();

/**
 * Root layout. Providers wrap the whole tree in the required order; the three
 * cross-cutting components (offline banner, toasts, auto-sync) sit above the navigator.
 */
export default function RootLayout() {
  useEffect(() => {
    const t = setTimeout(() => void SplashScreen.hideAsync().catch(() => undefined), 250);
    return () => clearTimeout(t);
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.parchment }}>
      <AppProviders>
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: colors.parchment },
            animation: 'slide_from_right',
          }}
        >
          <Stack.Screen name="index" />
          <Stack.Screen name="(auth)" options={{ animation: 'fade' }} />
          <Stack.Screen name="(pilgrim)" options={{ animation: 'fade' }} />
          <Stack.Screen name="(vendor)" options={{ animation: 'fade' }} />
          <Stack.Screen name="pay" />
          <Stack.Screen name="receipt" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
          <Stack.Screen name="vendor-verify" />
          <Stack.Screen name="crowd" />
          <Stack.Screen name="crowd-route" />
          <Stack.Screen name="emergency" options={{ animation: 'slide_from_bottom' }} />
          <Stack.Screen name="lost-person" />
          <Stack.Screen name="transaction/[id]" />
          <Stack.Screen name="demo" />
        </Stack>
        <OfflineBanner />
        <NotificationToaster />
        <AutoSyncManager />
      </AppProviders>
    </GestureHandlerRootView>
  );
}
