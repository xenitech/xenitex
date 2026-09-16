import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import type { DB } from '@xenitex/db';
import { newId } from '@xenitex/domain';
import type { Kysely } from 'kysely';
import { hashPassword } from '../auth/passwords.js';
import { buildDependencies, closeDependencies, type ApiDependencies } from '../dependencies.js';
import { loadConfig } from '../config.js';
import { buildServer } from '../server.js';

/**
 * Covers the six screens that were 404ing entirely before this route set
 * existed (dashboard/issues/assets/scan-runs/scope/administration) plus
 * the cross-cutting conventions (ADR 0006 cursor pagination, Idempotency-
 * Key, ETag/If-Match, EXT-09's hard-off feature flag) -- not exhaustive
 * per-endpoint coverage, which is real follow-up work, but enough to catch
 * a regression in the shared plumbing every one of these routes leans on.
 */
const RUN = Boolean(process.env.DATABASE_URL && process.env.REDIS_URL);

let deps: ApiDependencies;
let db: Kysely<DB>;

before(async () => {
  if (!RUN) {
    console.log('DATABASE_URL/REDIS_URL not set — skipping apps/api resource integration tests.');
    return;
  }
  deps = buildDependencies(loadConfig(process.env));
  db = deps.db;
});

after(async () => {
  if (!RUN) return;
  await closeDependencies(deps);
});

function extractCookie(
  setCookieHeaders: string | string[] | undefined,
  name: string,
): string | undefined {
  const headers = Array.isArray(setCookieHeaders)
    ? setCookieHeaders
    : setCookieHeaders
      ? [setCookieHeaders]
      : [];
  for (const header of headers) {
    const match = header.match(new RegExp(`${name}=([^;]+)`));
    if (match) return match[1];
  }
  return undefined;
}

async function adminSession(app: ReturnType<typeof buildServer>) {
  const email = `resources-admin-${randomUUID()}@example.test`;
  const password = 'correct-horse-battery-staple';
  const userId = newId();
  await db
    .insertInto('users')
    .values({
      id: userId,
      email,
      display_name: 'Resources Test Administrator',
      password_hash: await hashPassword(password),
      role: 'administrator',
    })
    .execute();
  const loginResponse = await app.inject({
    method: 'POST',
    url: '/v1/auth/login',
    // Distinct from the default 127.0.0.1 other test files' injected
    // requests use: SEC-11's IP-keyed rate limiter (10 logins/60s) is
    // shared Redis state, so without this every file's logins compete for
    // the same bucket and spuriously 429 each other out once enough test
    // files run back to back.
    remoteAddress: '10.99.1.1',
    payload: { email, password },
  });
  assert.equal(loginResponse.statusCode, 200);
  const sessionCookie = extractCookie(loginResponse.headers['set-cookie'], 'xenitex_session');
  const csrfCookie = extractCookie(loginResponse.headers['set-cookie'], 'xenitex_csrf');
  return {
    userId,
    headers: { cookie: `xenitex_session=${sessionCookie}`, 'x-csrf-token': csrfCookie! },
  };
}

test(
  'every list endpoint requires a session and returns {items, nextCursor}',
  { skip: !RUN },
  async () => {
    const app = buildServer(deps);
    for (const path of [
      '/v1/assets',
      '/v1/issues',
      '/v1/scan-runs',
      '/v1/exceptions',
      '/v1/reports',
    ]) {
      const unauth = await app.inject({ method: 'GET', url: path });
      assert.equal(unauth.statusCode, 401, `${path} should require a session`);
    }

    const { headers } = await adminSession(app);
    for (const path of [
      '/v1/assets',
      '/v1/issues',
      '/v1/scan-runs',
      '/v1/exceptions',
      '/v1/reports',
    ]) {
      const response = await app.inject({ method: 'GET', url: path, headers });
      assert.equal(response.statusCode, 200, `${path} should be reachable now`);
      const body = response.json();
      assert.ok(Array.isArray(body.items), `${path} must return an items array`);
      assert.ok('nextCursor' in body, `${path} must return a nextCursor field`);
    }
  },
);

test('GET /dashboard returns every required aggregate shape', { skip: !RUN }, async () => {
  const app = buildServer(deps);
  const { headers } = await adminSession(app);
  const response = await app.inject({ method: 'GET', url: '/v1/dashboard', headers });
  assert.equal(response.statusCode, 200);
  const body = response.json();
  for (const key of [
    'riskPosture',
    'topIssues',
    'exposureBreakdown',
    'criticalityBreakdown',
    'slaCompliance',
    'coverage',
    'activeScans',
  ]) {
    assert.ok(key in body, `dashboard response missing required field ${key}`);
  }
  assert.ok(Array.isArray(body.topIssues));
  assert.ok(Array.isArray(body.activeScans));
});

test(
  'POST /authorized-scopes is idempotent on retry, and creates the same resource GET returns',
  { skip: !RUN },
  async () => {
    const app = buildServer(deps);
    const { headers } = await adminSession(app);
    const payload = {
      name: `Resources test scope ${randomUUID()}`,
      cidrRanges: ['192.168.100.0/24'],
      hostnames: [],
      attestationType: 'self_attested_owner',
      attestationDetails: 'integration test',
    };
    const idempotencyKey = randomUUID();
    const first = await app.inject({
      method: 'POST',
      url: '/v1/authorized-scopes',
      headers: { ...headers, 'idempotency-key': idempotencyKey },
      payload,
    });
    assert.equal(first.statusCode, 201);
    const second = await app.inject({
      method: 'POST',
      url: '/v1/authorized-scopes',
      headers: { ...headers, 'idempotency-key': idempotencyKey },
      payload,
    });
    assert.equal(second.statusCode, 201);
    assert.equal(
      second.json().id,
      first.json().id,
      'retried request must not create a second resource',
    );

    const fetched = await app.inject({
      method: 'GET',
      url: `/v1/authorized-scopes/${first.json().id}`,
      headers,
    });
    assert.equal(fetched.statusCode, 200);
    assert.equal(fetched.json().name, payload.name);
  },
);

test(
  'PATCH /feature-flags/remediation_executor_enabled is hard-off (EXT-09/PRIN-01)',
  { skip: !RUN },
  async () => {
    const app = buildServer(deps);
    const { headers } = await adminSession(app);
    const response = await app.inject({
      method: 'PATCH',
      url: '/v1/feature-flags/remediation_executor_enabled',
      headers,
      payload: { isEnabled: true },
    });
    assert.equal(response.statusCode, 422);
    assert.equal(response.json().code, 'feature_flag.no_implementation');
  },
);

test('PATCH /organization-settings enforces If-Match (ADR 0006)', { skip: !RUN }, async () => {
  const app = buildServer(deps);
  const { headers } = await adminSession(app);

  const withoutIfMatch = await app.inject({
    method: 'PATCH',
    url: '/v1/organization-settings',
    headers,
    payload: { organizationName: 'Should be rejected' },
  });
  assert.equal(withoutIfMatch.statusCode, 409);

  const current = await app.inject({ method: 'GET', url: '/v1/organization-settings', headers });
  assert.equal(current.statusCode, 200);
  const etag = current.headers.etag as string;
  assert.ok(etag);

  const withIfMatch = await app.inject({
    method: 'PATCH',
    url: '/v1/organization-settings',
    headers: { ...headers, 'if-match': etag },
    payload: { organizationName: 'Resources Test Org' },
  });
  assert.equal(withIfMatch.statusCode, 200);
  assert.equal(withIfMatch.json().organizationName, 'Resources Test Org');
});
