// i18n setup. English is the default and fallback, German is fully shipped. The device
// locale is detected on first run; the user can override it in Settings (follow system,
// English, or German). Adding a language later is one new locale file plus one entry here.

import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { getLocales } from 'expo-localization';

import en from './locales/en.json';
import de from './locales/de.json';

export const resources = {
  en: { translation: en },
  de: { translation: de },
} as const;

export const SUPPORTED_LANGUAGES = ['en', 'de'] as const;
export type AppLanguage = (typeof SUPPORTED_LANGUAGES)[number];
export type LanguageSetting = AppLanguage | 'system';

function isSupported(code: string): code is AppLanguage {
  return (SUPPORTED_LANGUAGES as readonly string[]).includes(code);
}

export function deviceLanguage(): AppLanguage {
  const code = getLocales()[0]?.languageCode ?? 'en';
  return isSupported(code) ? code : 'en';
}

function resolve(setting: LanguageSetting): AppLanguage {
  return setting === 'system' ? deviceLanguage() : setting;
}

export function initI18n(setting: LanguageSetting = 'system'): void {
  if (i18n.isInitialized) {
    void i18n.changeLanguage(resolve(setting));
    return;
  }
  void i18n.use(initReactI18next).init({
    resources,
    lng: resolve(setting),
    fallbackLng: 'en',
    returnNull: false,
    interpolation: { escapeValue: false },
    // Fail loudly in development when a key is missing so gaps are caught early.
    saveMissing: __DEV__,
    missingKeyHandler: __DEV__
      ? (_lngs, _ns, key) => {
          throw new Error(`missing i18n key: ${key}`);
        }
      : undefined,
  });
}

export function setLanguage(setting: LanguageSetting): void {
  void i18n.changeLanguage(resolve(setting));
}

export default i18n;
