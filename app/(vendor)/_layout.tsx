import { Redirect, Tabs } from 'expo-router';
import React from 'react';
import { FloatingTabBar, type TabSpec } from '@/components/PilgrimTabBar';
import { usePendingCount } from '@/hooks/useLedger';
import { useAuth } from '@/providers/AuthProvider';
import { useI18n } from '@/providers/I18nProvider';

export default function VendorLayout() {
  const { status, user } = useAuth();
  const { t } = useI18n();
  const pending = usePendingCount();
  if (status === 'signedOut') return <Redirect href="/(auth)/login" />;
  if (status === 'signedIn' && user?.role !== 'VENDOR') return <Redirect href="/(pilgrim)/home" />;

  const tabs: TabSpec[] = [
    { name: 'dashboard', label: t('dashboard'), icon: 'grid-outline', iconActive: 'grid' },
    { name: 'transactions', label: t('transactions'), icon: 'list-outline', iconActive: 'list' },
    { name: 'accept', label: t('accept'), icon: 'scan-outline', iconActive: 'scan', hero: true },
    { name: 'sync', label: t('sync'), icon: 'cloud-upload-outline', iconActive: 'cloud-upload', badge: pending },
    { name: 'more', label: t('more'), icon: 'ellipsis-horizontal-circle-outline', iconActive: 'ellipsis-horizontal-circle' },
  ];

  return (
    <Tabs screenOptions={{ headerShown: false }} tabBar={(props) => <FloatingTabBar {...props} tabs={tabs} />}>
      <Tabs.Screen name="dashboard" />
      <Tabs.Screen name="transactions" />
      <Tabs.Screen name="accept" />
      <Tabs.Screen name="sync" />
      <Tabs.Screen name="more" />
      <Tabs.Screen name="settlement" options={{ href: null }} />
    </Tabs>
  );
}
