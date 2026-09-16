/**
 * SEC-01: the panel binds to a configurable interface; the default here is the
 * loopback interface, which is deliberately NOT what a real deployment should
 * run on. deploy/compose sets API_HOST to the appliance's private interface
 * explicitly — this default exists only so `pnpm dev` is safe to run on a
 * developer laptop without exposing anything.
 */
export interface ApiConfig {
  readonly host: string;
  readonly port: number;
  /** `postgres://user:password@host:port/database` — see deploy/compose/.env.example. */
  readonly databaseUrl: string;
  readonly redisUrl: string;
  /** SEC-03/DATA-01: the shared blob-store volume root — see deploy/compose/docker-compose.yml's `blobstore` volume. */
  readonly blobStoreRoot: string;
  readonly session: {
    readonly idleTimeoutMinutes: number;
    readonly absoluteTimeoutHours: number;
  };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  return {
    host: env.API_HOST ?? '127.0.0.1',
    port: env.API_PORT ? Number.parseInt(env.API_PORT, 10) : 8443,
    // Dev-only fallback targets the throwaway local Postgres a contributor
    // runs by hand (see README) — a real deployment always sets this via
    // .env (SEC-05), never relies on this default.
    databaseUrl: env.DATABASE_URL ?? 'postgres://postgres:xenitex_dev@127.0.0.1:5432/xenitex_dev',
    redisUrl: env.REDIS_URL ?? 'redis://127.0.0.1:6379',
    blobStoreRoot: env.BLOB_STORE_ROOT ?? '/tmp/xenitex-blob-store',
    session: {
      idleTimeoutMinutes: env.SESSION_IDLE_TIMEOUT_MINUTES
        ? Number.parseInt(env.SESSION_IDLE_TIMEOUT_MINUTES, 10)
        : 30,
      absoluteTimeoutHours: env.SESSION_ABSOLUTE_TIMEOUT_HOURS
        ? Number.parseInt(env.SESSION_ABSOLUTE_TIMEOUT_HOURS, 10)
        : 12,
    },
  };
}
