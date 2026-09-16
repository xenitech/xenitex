import { strict as assert } from 'node:assert';
import { readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, test } from 'node:test';
import pg from 'pg';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, '..', '..', '..', 'apps', 'api', 'db', 'migrations');
const migrateScript = join(here, 'migrate.ts');

/**
 * Real Postgres only (QA-01: never mocked) — requires DATABASE_URL, same
 * convention as apps/api/apps/worker's test:integration. Exercises the
 * up -> up (idempotent) -> down -> up cycle the README claims works,
 * against the runner apps/api and apps/worker actually use.
 */
async function tableCount(pool: pg.Pool): Promise<number> {
  const result = await pool.query<{ count: string }>(
    "SELECT count(*)::text AS count FROM information_schema.tables WHERE table_schema = 'public'",
  );
  return Number(result.rows[0]!.count);
}

async function runMigrate(direction: 'up' | 'down'): Promise<void> {
  await execFileAsync('npx', ['tsx', migrateScript, direction, migrationsDir], {
    env: process.env,
  });
}

let pool: pg.Pool;

before(() => {
  if (!process.env.DATABASE_URL) {
    console.log('DATABASE_URL not set — skipping packages/db migration integration test.');
    return;
  }
  pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
});

after(async () => {
  await pool?.end();
});

test(
  'up -> up (idempotent) -> down -> up leaves the schema in the same, correct state',
  { skip: !process.env.DATABASE_URL },
  async () => {
    const migrationFileCount = (await readdir(migrationsDir)).filter((f) =>
      f.endsWith('.up.sql'),
    ).length;
    assert.ok(migrationFileCount >= 1, 'expected at least one migration to test against');

    await runMigrate('up');
    const afterFirstUp = await tableCount(pool);
    assert.ok(afterFirstUp > 40, `expected the full schema (40+ tables), got ${afterFirstUp}`);

    // Idempotent: running up again must not error and must not change the count.
    await runMigrate('up');
    assert.equal(await tableCount(pool), afterFirstUp);

    await runMigrate('down');
    const afterDown = await tableCount(pool);
    assert.equal(
      afterDown,
      1,
      "only this runner's own schema_migrations bookkeeping table should remain",
    );

    await runMigrate('up');
    assert.equal(
      await tableCount(pool),
      afterFirstUp,
      're-applying up after down must restore the exact same schema',
    );
  },
);
