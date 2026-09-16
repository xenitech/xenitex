import { describe, expect, it } from 'vitest';
import { i18next, directionFor } from './index.js';

describe('i18n (P1-20)', () => {
  it('resolves a nested key in both bundled languages without falling back silently', () => {
    expect(i18next.getFixedT('en')('nav.issues')).toBe('Issues');
    expect(i18next.getFixedT('fa')('nav.issues')).toBe('مشکلات');
  });

  it('interpolates variables identically across languages', () => {
    const en = i18next.getFixedT('en')('components.riskExplainer.version', { version: 4 });
    const fa = i18next.getFixedT('fa')('components.riskExplainer.version', { version: 4 });
    expect(en).toContain('4');
    expect(fa).toContain('4');
  });

  it('maps Persian to RTL and English to LTR', () => {
    expect(directionFor('fa')).toBe('rtl');
    expect(directionFor('en')).toBe('ltr');
  });

  it('never silently falls back to the key itself for a bundled language', () => {
    // A missing translation would return the raw key ("nav.issues") rather
    // than resolved text — this is the tripwire that would catch it.
    for (const lang of ['en', 'fa'] as const) {
      expect(i18next.getFixedT(lang)('nav.issues')).not.toBe('nav.issues');
      expect(i18next.getFixedT(lang)('issues.detail.tabs.overview')).not.toBe(
        'issues.detail.tabs.overview',
      );
    }
  });
});
