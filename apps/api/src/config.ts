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
  /**
   * DATA-03/SEC-11. apps/api never faces a client directly — deploy/compose
   * puts nginx in front of it — so `request.ip` is the proxy's address on
   * every single request unless Fastify is told which hop to trust. Left
   * unset, that meant every audit entry recorded the same source address
   * and the per-source login rate limiter counted the whole appliance as
   * one client.
   *
   * This is an allowlist of trusted proxy addresses/CIDRs, never a bare
   * `true`: trusting any X-Forwarded-For lets a client forge its own
   * source address, which is worse than recording the proxy's.
   */
  readonly trustedProxies: readonly string[];
  /**
   * SEC-09 says TOTP is mandatory for operator and administrator, and
   * `mandatory` is therefore the shipped default — a deployment that has
   * not made a deliberate decision gets the compliant behaviour.
   *
   * `optional` is a real, explicit, operator-owned decision: it turns off
   * the ENROLMENT GATE only. Everything else about MFA keeps working —
   * anyone may enrol whenever they like, and once they have, their TOTP
   * challenge is required at every login and cannot be skipped. What
   * `optional` removes is the appliance refusing to serve a privileged
   * account that has not enrolled yet.
   *
   * This lives in configuration rather than in a database row on purpose.
   * A security control that the thing it protects can switch off — an
   * administrator session toggling a feature flag in the panel — is not
   * much of a control. Changing this requires access to the appliance host
   * and a restart, which is a different and much higher bar than holding a
   * stolen session cookie.
   */
  readonly mfaEnforcement: 'mandatory' | 'optional';
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
    // Anything other than the exact string 'optional' means mandatory —
    // a typo must fail towards the safe behaviour, never away from it.
    mfaEnforcement: env.MFA_ENFORCEMENT === 'optional' ? 'optional' : 'mandatory',
    trustedProxies: (env.TRUSTED_PROXY_CIDRS ?? '')
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0),
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
