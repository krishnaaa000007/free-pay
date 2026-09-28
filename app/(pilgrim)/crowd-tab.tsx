import React from 'react';
import { CrowdScreen } from '@/features/CrowdScreen';
import { layout } from '@/theme';

/** Crowd map as a pilgrim tab (the same screen is also reachable at /crowd). */
export default function CrowdTab() {
  return <CrowdScreen embedded bottomInset={layout.tabBarHeight} />;
}
