import { useEffect } from 'react';
import { startBroadcast } from '../services/stageBridge';

/**
 * Announce the QR currently on screen to the other window of a desktop demo, for as long
 * as it is displayed. Pass null whenever nothing is shown. Inert on a real phone — there
 * the other party uses the camera, which is what this stands in for.
 */
export function useDemoBroadcast(kind: 'MERCHANT' | 'QR' | 'RECEIPT', payload: string | null | undefined) {
  useEffect(() => {
    if (!payload) return;
    return startBroadcast(kind, payload);
  }, [kind, payload]);
}
