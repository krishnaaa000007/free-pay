import { Redirect, Tabs } from 'expo-router';
import React from 'react';
import { PilgrimTabBar, type TabSpec } from '@/components/PilgrimTabBar';
import { useAuth } from '@/providers/AuthProvider';
import { useI18n } from '@/providers/I18nProvider';

export default function PilgrimLayout() {
  const { status, user } = useAuth();
  const { t } = useI18n();
  if (status === 'signedOut') return <Redirect href="/(auth)/login" />;
  if (status === 'signedIn' && user?.role === 'VENDOR') return <Redirect href="/(vendor)/dashboard" />;

  const tabs: TabSpec[] = [
    { name: 'home', label: t('home'), icon: 'home-outline', iconActive: 'home' },
    { name: 'history', label: t('history'), icon: 'time-outline', iconActive: 'time' },
    { name: 'scan', label: t('scan'), icon: 'scan-outline', iconActive: 'scan', hero: true },
    { name: 'crowd-tab', label: t('crowdTitle'), icon: 'people-outline', iconActive: 'people' },
    { name: 'profile', label: t('profile'), icon: 'person-outline', iconActive: 'person' },
  ];

  return (
    <Tabs screenOptions={{ headerShown: false }} tabBar={(props) => <PilgrimTabBar {...props} tabs={tabs} />}>
      <Tabs.Screen name="home" />
      <Tabs.Screen name="history" />
      <Tabs.Screen name="scan" />
      <Tabs.Screen name="crowd-tab" />
      <Tabs.Screen name="profile" />
    </Tabs>
  );
}
