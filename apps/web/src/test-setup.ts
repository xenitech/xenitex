import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';
import './i18n/index.js';

// Vitest isn't configured with `globals: true`, so @testing-library/react's
// usual auto-cleanup-on-afterEach never self-registers — without this, one
// test's rendered tree leaks into the next test in the same file.
afterEach(() => {
  cleanup();
});
