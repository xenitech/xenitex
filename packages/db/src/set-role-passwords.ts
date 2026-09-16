#!/usr/bin/env node
/**
 * One-off/rotation step, separate from migrate.ts: 0001_init.up.sql creates
 * `xenitex_app` and `xenitex_retention_worker` as LOGIN roles with no
 * password (a real password value has no business sitting in a checked-in
 * migration file — SEC-05). This sets it, idempotently, from secrets
 * supplied at run time instead.
 *
 * Usage: tsx set-role-passwords.ts
 * Reads: DATABASE_URL (or PG* vars) for a superuser connection, plus
 * XENITEX_APP_PASSWORD and XENITEX_RETENTION_WORKER_PASSWORD for the
 * values to set.
 */
import pg from 'pg';

async function main(): Promise<void> {
  const appPassword = process.env.XENITEX_APP_PASSWORD;
  const retentionWorkerPassword = process.env.XENITEX_RETENTION_WORKER_PASSWORD;
  if (!appPassword || !retentionWorkerPassword) {
    throw new Error(
      'Usage: XENITEX_APP_PASSWORD=... XENITEX_RETENTION_WORKER_PASSWORD=... tsx set-role-passwords.ts',
    );
  }

  // ALTER ROLE ... PASSWORD is a utility statement, not a regular DML
  // command -- Postgres's grammar doesn't accept a `$1` bind parameter in
  // that position (confirmed: it's a syntax error, not just unsupported).
  // quote_literal() runs server-side via a plain SELECT bind parameter
  // instead, so the value never touches string concatenation on our end.
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  try {
    const quoteLiteral = async (value: string): Promise<string> => {
      const result = await client.query<{ quoted: string }>('SELECT quote_literal($1) AS quoted', [
        value,
      ]);
      return result.rows[0]!.quoted;
    };
    await client.query(`ALTER ROLE xenitex_app WITH PASSWORD ${await quoteLiteral(appPassword)}`);
    await client.query(
      `ALTER ROLE xenitex_retention_worker WITH PASSWORD ${await quoteLiteral(retentionWorkerPassword)}`,
    );
    console.log('set passwords for xenitex_app, xenitex_retention_worker');
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
