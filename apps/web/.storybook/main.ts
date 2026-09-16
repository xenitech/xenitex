import type { StorybookConfig } from '@storybook/react-vite';

const config: StorybookConfig = {
  stories: ['../src/**/*.stories.@(ts|tsx)'],
  addons: ['@storybook/addon-essentials', '@storybook/addon-a11y'],
  framework: {
    name: '@storybook/react-vite',
    options: {},
  },
  // P1-26: no CDN, no external fonts, no analytics anywhere in this project —
  // Storybook is a dev-only tool and never ships in the appliance, but it
  // still shouldn't reach out to the network for anything while running.
  core: {
    disableTelemetry: true,
  },
};

export default config;
