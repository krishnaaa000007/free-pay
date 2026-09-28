import React from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider } from './AuthProvider';
import { I18nProvider } from './I18nProvider';
import { NetworkProvider } from './NetworkProvider';
import { QueryProvider } from './QueryProvider';

/** Provider order is significant: SafeArea -> QueryClient -> I18n -> Auth -> Network. */
export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <SafeAreaProvider>
      <QueryProvider>
        <I18nProvider>
          <AuthProvider>
            <NetworkProvider>{children}</NetworkProvider>
          </AuthProvider>
        </I18nProvider>
      </QueryProvider>
    </SafeAreaProvider>
  );
}

export { useAuth } from './AuthProvider';
export { useI18n } from './I18nProvider';
export { useNetwork } from './NetworkProvider';
