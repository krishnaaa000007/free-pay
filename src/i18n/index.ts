import type { Language } from '../domain/types';
import { en, type Dictionary, type TranslationKey } from './en';
import { gu } from './gu';
import { hi } from './hi';
import { mr } from './mr';
import { ta } from './ta';

export type { Dictionary, TranslationKey };

export const dictionaries: Record<Language, Dictionary> = { en, hi, mr, gu, ta };

export const LANGUAGES: Array<{ code: Language; label: string; native: string; speechTag: string }> = [
  { code: 'en', label: 'English', native: 'English', speechTag: 'en-IN' },
  { code: 'hi', label: 'Hindi', native: 'हिन्दी', speechTag: 'hi-IN' },
  { code: 'mr', label: 'Marathi', native: 'मराठी', speechTag: 'mr-IN' },
  { code: 'gu', label: 'Gujarati', native: 'ગુજરાતી', speechTag: 'gu-IN' },
  { code: 'ta', label: 'Tamil', native: 'தமிழ்', speechTag: 'ta-IN' },
];

export function isLanguage(v: unknown): v is Language {
  return typeof v === 'string' && v in dictionaries;
}

/** Replace `{name}` placeholders. Missing params are left visible to make bugs obvious. */
export function interpolate(template: string, params?: Record<string, string | number>): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in params ? String(params[k]) : m));
}

/** Translate with fallback to English so an incomplete dictionary never shows a raw key. */
export function translate(lang: Language, key: TranslationKey, params?: Record<string, string | number>): string {
  const dict = dictionaries[lang] ?? en;
  const template = dict[key] ?? en[key] ?? key;
  return interpolate(template, params);
}

export function speechLanguageTag(lang: Language): string {
  return LANGUAGES.find((l) => l.code === lang)?.speechTag ?? 'en-IN';
}
