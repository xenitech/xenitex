import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { loadConfig } from './config.js';
import { buildDependencies, closeDependencies } from './dependencies.js';
import { buildServer } from './server.js';

// Deliberately points at nothing real (an address nothing listens on in the
// plain `test` job — only `test:integration` runs with a live Postgres/Redis,
// per QA-01/README). This is not "mocking the database": no response is
// faked, the pool genuinely fails to connect, and checkDatabase/checkRedis's
// catch branches are exercised for real. See server.integration.test.ts for
// the "everything is actually healthy" case against real dependencies.
const unreachableConfig = loadConfig({
  DATABASE_URL: 'postgres://nobody:nothing@127.0.0.1:1/nowhere',
  REDIS_URL: 'redis://127.0.0.1:1',
  BLOB_STORE_ROOT: '/nonexistent-path-for-test',
});

const deps = buildDependencies(unreachableConfig);
after(() => closeDependencies(deps));

test('GET /healthz returns 200 ok with no dependency calls at all', async () => {
  const app = buildServer(deps);
  const response = await app.inject({ method: 'GET', url: '/healthz' });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { status: 'ok' });
});

test('GET /readyz returns 503 when every dependency is genuinely unreachable', async () => {
  const app = buildServer(deps);
  const response = await app.inject({ method: 'GET', url: '/readyz' });
  assert.equal(response.statusCode, 503);
  const body = response.json();
  assert.equal(body.status, 'not_ready');
  assert.equal(body.checks.database, 'error');
  assert.equal(body.checks.redis, 'error');
  assert.equal(body.checks.blobStore, 'error');
});
