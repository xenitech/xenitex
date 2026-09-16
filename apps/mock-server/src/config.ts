/**
 * Mirrors apps/api/src/config.ts's binding convention (SEC-01: loopback by
 * default, never a laptop-exposing default). This app is dev-only tooling —
 * see package.json's description — so there is no deploy/compose entry to
 * keep consistent with, but the same safe-default principle still applies.
 */
export interface MockServerConfig {
  readonly host: string;
  readonly port: number;
  /** PERF-01 fixture is 5k assets / 50k issues / 250k observations by default; a smaller seed speeds up local iteration. */
  readonly fixtureScale: 'perf01' | 'small';
  readonly seed: number;
  /** P1-06: boots with an incomplete first-run wizard so the real setup screens have something to walk through, instead of always seeing a pre-completed org. */
  readonly setupIncomplete: boolean;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): MockServerConfig {
  return {
    host: env.MOCK_SERVER_HOST ?? '127.0.0.1',
    port: env.MOCK_SERVER_PORT ? Number.parseInt(env.MOCK_SERVER_PORT, 10) : 8081,
    fixtureScale: env.MOCK_SERVER_FIXTURE_SCALE === 'small' ? 'small' : 'perf01',
    seed: env.MOCK_SERVER_SEED ? Number.parseInt(env.MOCK_SERVER_SEED, 10) : 42,
    setupIncomplete: env.MOCK_SERVER_SETUP_INCOMPLETE === 'true',
  };
}
