import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

/**
 * Storage facade.
 *  - secure*: hardware-backed keychain/keystore for the device signing key and JWT.
 *  - pref*:   AsyncStorage for non-sensitive preferences and caches.
 * On web SecureStore is unavailable, so we fall back to AsyncStorage (dev convenience only).
 */
const SECURE_KEYS = {
  token: 'freepay.auth.token',
  deviceSecretKey: 'freepay.device.sk',
  devicePublicKey: 'freepay.device.pk',
  deviceId: 'freepay.device.id',
  walletCertificate: 'freepay.wallet.cert',
} as const;

const PREF_KEYS = {
  language: 'freepay.pref.language',
  onboarded: 'freepay.pref.onboarded',
  user: 'freepay.cache.user',
  merchant: 'freepay.cache.merchant',
  platformKey: 'freepay.cache.platformKey',
  lastSyncAt: 'freepay.sync.lastAt',
  forceOffline: 'freepay.demo.forceOffline',
  contacts: 'freepay.cache.contacts',
  merchantsDir: 'freepay.cache.merchants',
  crowd: 'freepay.cache.crowd',
} as const;

export type SecureKey = keyof typeof SECURE_KEYS;
export type PrefKey = keyof typeof PREF_KEYS;

const secureAvailable = Platform.OS !== 'web';

export async function secureGet(key: SecureKey): Promise<string | null> {
  const k = SECURE_KEYS[key];
  return secureAvailable ? SecureStore.getItemAsync(k) : AsyncStorage.getItem(k);
}

export async function secureSet(key: SecureKey, value: string): Promise<void> {
  const k = SECURE_KEYS[key];
  if (secureAvailable) await SecureStore.setItemAsync(k, value, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY });
  else await AsyncStorage.setItem(k, value);
}

export async function secureDelete(key: SecureKey): Promise<void> {
  const k = SECURE_KEYS[key];
  if (secureAvailable) await SecureStore.deleteItemAsync(k);
  else await AsyncStorage.removeItem(k);
}

export async function prefGet<T = string>(key: PrefKey, parse = false): Promise<T | null> {
  const raw = await AsyncStorage.getItem(PREF_KEYS[key]);
  if (raw === null) return null;
  if (!parse) return raw as unknown as T;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function prefSet(key: PrefKey, value: unknown): Promise<void> {
  await AsyncStorage.setItem(PREF_KEYS[key], typeof value === 'string' ? value : JSON.stringify(value));
}

export async function prefDelete(key: PrefKey): Promise<void> {
  await AsyncStorage.removeItem(PREF_KEYS[key]);
}

/** Clear session data on sign-out. The device key stays: it is bound to the phone, not the login. */
export async function clearSession(): Promise<void> {
  await Promise.all([
    secureDelete('token'),
    secureDelete('walletCertificate'),
    prefDelete('user'),
    prefDelete('merchant'),
    prefDelete('lastSyncAt'),
  ]);
}
