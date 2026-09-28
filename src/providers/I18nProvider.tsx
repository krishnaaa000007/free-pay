import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { appConfig } from '../domain/config';
import type { Language } from '../domain/types';
import { isLanguage, translate, type TranslationKey } from '../i18n';
import { prefGet, prefSet } from '../services/storage';

export type TFunction = (key: TranslationKey, params?: Record<string, string | number>) => string;

interface I18nContextValue {
  language: Language;
  setLanguage: (lang: Language) => Promise<void>;
  t: TFunction;
  ready: boolean;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [language, setLang] = useState<Language>(appConfig.defaultLanguage);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    prefGet('language')
      .then((saved) => {
        if (isLanguage(saved)) setLang(saved);
      })
      .finally(() => setReady(true));
  }, []);

  const setLanguage = useCallback(async (lang: Language) => {
    setLang(lang);
    await prefSet('language', lang);
  }, []);

  const t = useCallback<TFunction>((key, params) => translate(language, key, params), [language]);

  const value = useMemo(() => ({ language, setLanguage, t, ready }), [language, setLanguage, t, ready]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used inside I18nProvider');
  return ctx;
}
