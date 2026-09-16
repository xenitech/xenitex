import type { Preview } from '@storybook/react';
import React, { useEffect } from 'react';
import { I18nextProvider } from 'react-i18next';
import '../src/design/tokens.css';
import { i18next } from '../src/i18n/index.js';

/**
 * Every component in the §5 catalogue must be checked in both themes, both
 * densities, and both directions (3.1) — these are Storybook toolbar
 * controls rather than three separate story variants per component, so a
 * reviewer can flip any one of the three without re-navigating.
 */
const preview: Preview = {
  parameters: {
    layout: 'centered',
    backgrounds: { disable: true }, // theme decorator below owns the surface colour, not the backgrounds addon
    a11y: {
      // QA-06: automated checks run here; the manual keyboard-only /
      // screen-reader pass happens against the real screens, not stories.
      test: 'error',
    },
  },
  globalTypes: {
    theme: {
      description: 'Theme (P1-21)',
      toolbar: {
        icon: 'circlehollow',
        items: [
          { value: 'light', title: 'Light' },
          { value: 'dark', title: 'Dark' },
        ],
        dynamicTitle: true,
      },
    },
    density: {
      description: 'Density (UI-04, UI-30)',
      toolbar: {
        icon: 'component',
        items: [
          { value: 'compact', title: 'Compact' },
          { value: 'comfortable', title: 'Comfortable' },
        ],
        dynamicTitle: true,
      },
    },
    direction: {
      description: 'Direction (UI-94, P1-20)',
      toolbar: {
        icon: 'transfer',
        items: [
          { value: 'ltr', title: 'LTR (English)' },
          { value: 'rtl', title: 'RTL (Persian)' },
        ],
        dynamicTitle: true,
      },
    },
  },
  initialGlobals: {
    theme: 'dark', // the analyst's default, per tokens.css
    density: 'compact',
    direction: 'ltr',
  },
  decorators: [
    (Story, context) => {
      const { theme, density, direction } = context.globals as {
        theme: 'light' | 'dark';
        density: 'compact' | 'comfortable';
        direction: 'ltr' | 'rtl';
      };

      useEffect(() => {
        const root = document.documentElement;
        root.dataset.theme = theme;
        root.dataset.density = density === 'comfortable' ? 'comfortable' : '';
        root.dir = direction;
        // Direction and language are one control here (P1-20): RTL only
        // matters in this product because Persian is a real, translated
        // language, not a mirrored-CSS exercise — every story renders with
        // its actual Persian strings, not English text force-flipped.
        void i18next.changeLanguage(direction === 'rtl' ? 'fa' : 'en');
      }, [theme, density, direction]);

      return (
        <I18nextProvider i18n={i18next}>
          <div
            dir={direction}
            style={{
              background: 'var(--color-surface)',
              color: 'var(--color-ink)',
              fontFamily: 'var(--font-sans)',
              fontSize: 'var(--font-size-sm)',
              padding: 'var(--space-7)',
            }}
          >
            <Story />
          </div>
        </I18nextProvider>
      );
    },
  ],
};

export default preview;
