import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// P1-26: no CDN, no external fonts, no analytics — everything self-hosted, since
// the appliance is air-gapped at runtime. Bundle-budget enforcement lands with
// the first real screen in Step 3.
export default defineConfig({
  plugins: [react()],
  server: {
    // Same-origin in dev so the session cookie (SEC-08) round-trips without
    // CORS gymnastics, matching how a reverse proxy fronts API + web on one
    // origin in the reference deployment (deploy/compose).
    proxy: {
      '/v1': {
        target: process.env.VITE_MOCK_SERVER_URL ?? 'http://127.0.0.1:8081',
        changeOrigin: false,
      },
    },
  },
  test: {
    environment: 'jsdom',
    // Vitest's default include glob also matches `*.spec.ts`, which collides
    // with tests/visual/*.spec.ts (Playwright visual regression specs, run
    // separately via `pnpm test:visual`) -- scoped to src/ so Vitest never
    // tries to execute a Playwright test file under jsdom.
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['src/test-setup.ts'],
  },
});
