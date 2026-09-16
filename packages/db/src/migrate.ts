#!/usr/bin/env node
/**
 * The "~40-line custom runner around a schema_migrations table" the
 * migrations README (apps/api/db/migrations/README.md) said would satisfy
 * the convention — deliberately not a full migration framework, since the
 * project chose plain reviewable `.sql` over any ORM/DSL (docs/adr/0009).
 *
 * Usage: tsx migrate.ts <up|down> <migrationsDir> [--to <name>]
 * - up:   applies every *.up.sql not yet recorded, in filename order.
 * - down: reverts the single most-recently-applied migration's *.down.sql.
 *
 * Connection comes from DATABASE_URL, or discrete PG* env vars via `pg`'s
 * own defaults — never a hardcoded credential (SEC-05).
 */
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import pg from 'pg';

async function ensureMigrationsTable(client: pg.PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
}

async function appliedMigrations(client: pg.PoolClient): Promise<Set<string>> {
  const result = await client.query<{ name: string }>('SELECT name FROM schema_migrations');
  return new Set(result.rows.map((row) => row.name));
}

async function up(client: pg.PoolClient, migrationsDir: string): Promise<void> {
  const files = (await readdir(migrationsDir)).filter((f) => f.endsWith('.up.sql')).sort();
  const applied = await appliedMigrations(client);

  for (const file of files) {
    const name = file.replace(/\.up\.sql$/, '');
    if (applied.has(name)) {
      console.log(`skip  ${name} (already applied)`);
      continue;
    }
    const sql = await readFile(join(migrationsDir, file), 'utf8');
    console.log(`apply ${name}`);
    await client.query('BEGIN');
    try {
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [name]);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }
  }
}

async function down(client: pg.PoolClient, migrationsDir: string): Promise<void> {
  const applied = [...(await appliedMigrations(client))].sort();
  const last = applied.at(-1);
  if (!last) {
    console.log('nothing to roll back');
    return;
  }
  const sql = await readFile(join(migrationsDir, `${last}.down.sql`), 'utf8');
  console.log(`revert ${last}`);
  await client.query('BEGIN');
  try {
    // schema_migrations is this runner's own bookkeeping table, created
    // before any migration's `up.sql` runs — a blanket
    // `GRANT ALL ON ALL TABLES IN SCHEMA public` (as 0001_init.up.sql
    // issues for the app role) sweeps it up too, which then blocks
    // `DROP ROLE` in `down.sql` with "cannot be dropped because some
    // objects depend on it". Revoking here first, on the one table the
    // migrations themselves don't know about, is this runner's problem to
    // solve, not something to work around by editing a migration.
    await client.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'xenitex_app') THEN
          REVOKE ALL ON schema_migrations FROM xenitex_app;
        END IF;
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'xenitex_retention_worker') THEN
          REVOKE ALL ON schema_migrations FROM xenitex_retention_worker;
        END IF;
      END
      $$;
    `);
    await client.query(sql);
    await client.query('DELETE FROM schema_migrations WHERE name = $1', [last]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  }
}

async function main(): Promise<void> {
  const [direction, migrationsDir] = process.argv.slice(2);
  if (direction !== 'up' && direction !== 'down') {
    throw new Error('Usage: migrate.ts <up|down> <migrationsDir>');
  }
  if (!migrationsDir) {
    throw new Error('Usage: migrate.ts <up|down> <migrationsDir>');
  }

  // node-postgres reads discrete PG* env vars automatically but not
  // DATABASE_URL — pass it explicitly so both conventions work.
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  try {
    await ensureMigrationsTable(client);
    if (direction === 'up') await up(client, migrationsDir);
    else await down(client, migrationsDir);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
