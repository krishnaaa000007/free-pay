import { useLocalSearchParams } from 'expo-router';
import React from 'react';
import { VendorVerify } from '@/features/VendorVerify';

/** Standalone accept/verify screen (also used by the pitch demo with a pre-filled payload). */
export default function VendorVerifyRoute() {
  const { payload } = useLocalSearchParams<{ payload?: string }>();
  return <VendorVerify initialPayload={payload} />;
}
