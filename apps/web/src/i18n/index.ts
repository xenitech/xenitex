import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import { en } from './locales/en.js';
import { fa } from './locales/fa.js';

export const SUPPORTED_LANGUAGES = ['en', 'fa'] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

/** P1-20: only these two are RTL-relevant here, but this is the single place a third RTL language would extend. */
const RTL_LANGUAGES: ReadonlySet<SupportedLanguage> = new Set(['fa']);

export function directionFor(language: string): 'ltr' | 'rtl' {
  return RTL_LANGUAGES.has(language as SupportedLanguage) ? 'rtl' : 'ltr';
}

const LANGUAGE_STORAGE_KEY = 'xenitex.language';

/** UI preference only (P1-24) — never a session token or finding data. */
export function readStoredLanguage(): SupportedLanguage | undefined {
  const stored = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
  return SUPPORTED_LANGUAGES.includes(stored as SupportedLanguage)
    ? (stored as SupportedLanguage)
    : undefined;
}

export function storeLanguage(language: SupportedLanguage): void {
  window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
}

void i18next.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    fa: { translation: fa },
  },
  lng: readStoredLanguage() ?? 'en',
  fallbackLng: 'en',
  interpolation: { escapeValue: false }, // React already escapes; double-escaping would corrupt Persian/RTL punctuation.
  returnNull: false,
});

export { i18next };
