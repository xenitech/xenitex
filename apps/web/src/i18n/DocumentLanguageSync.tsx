import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { directionFor, storeLanguage, type SupportedLanguage } from './index.js';

/** P1-20: keeps <html lang>/<html dir> — and therefore every browser default (scrollbars, form controls, text alignment) — in sync with the active language, not just component-level CSS. */
export function DocumentLanguageSync() {
  const { i18n } = useTranslation();

  useEffect(() => {
    const apply = (language: string) => {
      document.documentElement.lang = language;
      document.documentElement.dir = directionFor(language);
    };
    apply(i18n.language);
    const onChanged = (language: string) => {
      apply(language);
      storeLanguage(language as SupportedLanguage);
    };
    i18n.on('languageChanged', onChanged);
    return () => i18n.off('languageChanged', onChanged);
  }, [i18n]);

  return null;
}
