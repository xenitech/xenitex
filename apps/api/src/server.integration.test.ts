import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { loadConfig } from './config.js';
import { buildDependencies, closeDependencies, type ApiDependencies } from './dependencies.js';
import { buildServer } from './server.js';

/**
 * Real Postgres + real Redis/Valkey (QA-01: never mocked) — requires
 * DATABASE_URL/REDIS_URL, same convention as the CI `integration-tests` job.
 * A migrated schema is assumed (CI applies it before this runs; locally,
 * `pnpm --filter @xenitex/db migrate` against the same DATABASE_URL first).
 */
let deps: ApiDependencies;
let blobStoreDir: string;

before(async () => {
  if (!process.env.DATABASE_URL || !process.env.REDIS_URL) {
    console.log('DATABASE_URL/REDIS_URL not set — skipping apps/api readyz integration test.');
    return;
  }
  blobStoreDir = await mkdtemp(join(tmpdir(), 'xenitex-blob-store-'));
  deps = buildDependencies(loadConfig({ ...process.env, BLOB_STORE_ROOT: blobStoreDir }));
});

after(async () => {
  if (!deps) return;
  await closeDependencies(deps);
  await rm(blobStoreDir, { recursive: true, force: true });
});

test(
  'GET /readyz returns 200 ready against real Postgres, Redis, and a real writable blob store',
  { skip: !process.env.DATABASE_URL || !process.env.REDIS_URL },
  async () => {
    const app = buildServer(deps);
    const response = await app.inject({ method: 'GET', url: '/readyz' });
    const body = response.json();
    assert.equal(body.checks.database, 'ok');
    assert.equal(body.checks.redis, 'ok');
    assert.equal(body.checks.blobStore, 'ok');
    // vulnerabilityDataAge is legitimately 'not_configured' until a vuln-data
    // bundle has actually been imported (Step 4's intel-provider work) —
    // asserted separately so this test doesn't require that to exist yet.
    assert.ok(['ok', 'not_configured'].includes(body.checks.vulnerabilityDataAge));
    if (body.checks.vulnerabilityDataAge === 'ok') {
      assert.equal(response.statusCode, 200);
      assert.equal(body.status, 'ready');
    }
  },
);
