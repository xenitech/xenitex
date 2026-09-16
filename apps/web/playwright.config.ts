import { defineConfig, devices } from '@playwright/test';

/**
 * P1-27: visual regression tests for every component in the §5 catalogue.
 * Runs against the static Storybook build (`pnpm build-storybook` first),
 * not the dev server — deterministic input for pixel comparison. Stories
 * are discovered from storybook-static/index.json at test-collection time
 * (see tests/visual/components.visual.spec.ts) rather than hand-listed, so
 * a new *.stories.tsx file is covered automatically.
 */
export default defineConfig({
  testDir: './tests/visual',
  snapshotPathTemplate: '{testDir}/__screenshots__/{arg}{ext}',
  fullyParallel: true,
  reporter: 'list',
  expect: {
    // Tight tolerance is only safe because the test screenshots the
    // component element itself, not the full page (see components.visual.spec.ts) --
    // a full-page screenshot at default viewport size made a real colour
    // regression invisible at 1% pixel-ratio tolerance, since the component
    // occupied well under 1% of the captured pixels. Caught by deliberately
    // introducing a regression and watching this suite fail to catch it
    // before this config existed.
    toHaveScreenshot: { maxDiffPixelRatio: 0.005 },
  },
  use: {
    baseURL: 'http://127.0.0.1:6007',
    colorScheme: 'no-preference',
  },
  webServer: {
    command: 'node scripts/static-server.mjs storybook-static 6007',
    url: 'http://127.0.0.1:6007',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
