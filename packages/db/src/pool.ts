import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';
import type { DB } from './generated/schema.js';

export interface DbConnectionConfig {
  /** `postgres://user:password@host:port/database` — matches the DATABASE_URL convention established in deploy/compose/.env.example and CI. */
  readonly connectionString: string;
  /** Small by default — this is a single-VPS appliance at PERF-01 scale (Part A.5), not a fleet. */
  readonly maxConnections?: number;
}

/**
 * SEC-03: apps/worker calls this with the same config shape as apps/api —
 * neither app holds any DB access the other doesn't, and both go through
 * this one factory rather than each rolling its own pool setup.
 */
export function createDb(config: DbConnectionConfig): Kysely<DB> {
  const pool = new pg.Pool({
    connectionString: config.connectionString,
    max: config.maxConnections ?? 10,
  });

  return new Kysely<DB>({
    dialect: new PostgresDialect({ pool }),
  });
}

export type { DB } from './generated/schema.js';
export { sql } from 'kysely';
