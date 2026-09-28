import { dictionaries, interpolate, isLanguage, LANGUAGES, speechLanguageTag, translate } from '@/i18n';
import { en } from '@/i18n/en';

describe('i18n', () => {
  const keys = Object.keys(en) as Array<keyof typeof en>;

  it('every language provides every key with a non-empty string', () => {
    for (const l of LANGUAGES) {
      const dict = dictionaries[l.code];
      const missing = keys.filter((k) => typeof dict[k] !== 'string' || dict[k].trim() === '');
      expect({ lang: l.code, missing }).toEqual({ lang: l.code, missing: [] });
    }
  });

  it('keeps interpolation placeholders consistent across languages', () => {
    const placeholders = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();
    for (const l of LANGUAGES) {
      for (const k of keys) {
        expect({ lang: l.code, key: k, ph: placeholders(dictionaries[l.code][k]) }).toEqual({ lang: l.code, key: k, ph: placeholders(en[k]) });
      }
    }
  });

  it('interpolates parameters and leaves unknown ones visible', () => {
    expect(interpolate('Valid for {days} days', { days: 7 })).toBe('Valid for 7 days');
    expect(interpolate('{a} and {b}', { a: 'x' })).toBe('x and {b}');
  });

  it('translates with fallback to English', () => {
    expect(translate('hi', 'credentialValid', { days: 3 })).toBe('प्रमाण 3 दिन और मान्य');
    expect(translate('ta', 'appName')).toBe('ஃப்ரீ பே');
    expect(translate('en', 'statusSYNCED')).toBe('Synced');
  });

  it('exposes five languages with speech tags', () => {
    expect(LANGUAGES.map((l) => l.code)).toEqual(['en', 'hi', 'mr', 'gu', 'ta']);
    expect(speechLanguageTag('hi')).toBe('hi-IN');
    expect(isLanguage('gu')).toBe(true);
    expect(isLanguage('fr')).toBe(false);
  });
});
