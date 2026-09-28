import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React, { useState } from 'react';

/**
 * React Query with offline-first defaults: queries serve cached data when the radio is
 * dead instead of erroring, and retries are kept short so the UI never feels stuck.
 */
export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: 1,
            retryDelay: 1200,
            staleTime: 30_000,
            gcTime: 24 * 60 * 60 * 1000,
            networkMode: 'offlineFirst',
            refetchOnWindowFocus: false,
          },
          mutations: { networkMode: 'offlineFirst', retry: 0 },
        },
      }),
  );
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
