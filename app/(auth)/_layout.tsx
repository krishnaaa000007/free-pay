import { Redirect, Stack } from 'expo-router';
import React from 'react';
import { useAuth } from '@/providers/AuthProvider';
import { colors } from '@/theme';

export default function AuthLayout() {
  const { status, user } = useAuth();
  if (status === 'signedIn') return <Redirect href={user?.role === 'VENDOR' ? '/(vendor)/dashboard' : '/(pilgrim)/home'} />;
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.parchment }, animation: 'slide_from_right' }}>
      <Stack.Screen name="onboarding" options={{ animation: 'fade' }} />
      <Stack.Screen name="login" />
      <Stack.Screen name="register" />
      <Stack.Screen name="forgot-password" />
    </Stack>
  );
}
