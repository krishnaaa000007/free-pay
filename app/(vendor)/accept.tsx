import React from 'react';
import { VendorVerify } from '@/features/VendorVerify';
import { layout } from '@/theme';

/** The vendor's hero tab: scan and accept a pilgrim's payment code. */
export default function AcceptTab() {
  return <VendorVerify embedded bottomInset={layout.tabBarHeight} />;
}
