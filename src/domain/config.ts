import { INR } from './money';
import type { EmergencyContact, Language } from './types';

/**
 * Typed view over EXPO_PUBLIC_* environment variables with the same defaults the server
 * uses, so both ends enforce identical limits when the env is left blank.
 */
const num = (v: string | undefined, def: number) => {
  const n = Number(v);
  return v === undefined || v === '' || !Number.isFinite(n) ? def : n;
};

export const HARD_MAX_OFFLINE_AGE_DAYS = 10;

function parseContacts(raw: string | undefined): EmergencyContact[] {
  return (raw ?? 'Mela Control Room:1077,Police:112,Ambulance:108,Lost and Found:1098')
    .split(',')
    .map((pair) => {
      const idx = pair.lastIndexOf(':');
      return idx === -1 ? null : { label: pair.slice(0, idx).trim(), number: pair.slice(idx + 1).trim() };
    })
    .filter((c): c is EmergencyContact => !!c && !!c.label && !!c.number);
}

const langs: Language[] = ['en', 'hi', 'mr', 'gu', 'ta'];
const defaultLang = (process.env.EXPO_PUBLIC_DEFAULT_LANGUAGE ?? 'en') as Language;

export const appConfig = {
  apiUrl: (process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:4000').replace(/\/$/, ''),
  platformPublicKey: process.env.EXPO_PUBLIC_PLATFORM_PUBKEY ?? '',
  limits: {
    maxOfflineTxnPaise: INR(num(process.env.EXPO_PUBLIC_MAX_OFFLINE_TXN_INR, 2000)),
    maxOfflineDailyPaise: INR(num(process.env.EXPO_PUBLIC_MAX_OFFLINE_DAILY_INR, 5000)),
    maxOfflineAgeMs: Math.min(num(process.env.EXPO_PUBLIC_MAX_OFFLINE_AGE_DAYS, 10), HARD_MAX_OFFLINE_AGE_DAYS) * 86_400_000,
    onlineReceiptTtlMs: num(process.env.EXPO_PUBLIC_ONLINE_RECEIPT_TTL_MIN, 15) * 60_000,
  },
  emergencyContacts: parseContacts(process.env.EXPO_PUBLIC_EMERGENCY_CONTACTS),
  /**
   * Presentation aid, off unless explicitly enabled. Lets two browser windows on one
   * desktop hand each other the QR string they are displaying, standing in for a camera
   * that cannot see the other monitor. Verification is untouched. Never set in production.
   */
  demoRelay: (process.env.EXPO_PUBLIC_DEMO_RELAY ?? '') === '1',
  defaultLanguage: langs.includes(defaultLang) ? defaultLang : 'en',
  version: '0.1.0',
};

export type AppConfig = typeof appConfig;
