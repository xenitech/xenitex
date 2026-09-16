import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildMockServer } from './server.js';
import type { MockServerConfig } from './config.js';

const config: MockServerConfig = {
  host: '127.0.0.1',
  port: 0,
  fixtureScale: 'small',
  seed: 99,
  setupIncomplete: false,
};

async function withApp<T>(
  fn: (app: Awaited<ReturnType<typeof buildMockServer>>) => Promise<T>,
): Promise<T> {
  const app = await buildMockServer(config);
  try {
    return await fn(app);
  } finally {
    await app.close();
  }
}

test('ADR 0006: list endpoints return { items, nextCursor } and paginate correctly', async () => {
  await withApp(async (app) => {
    const first = await app.inject({
      method: 'GET',
      url: '/v1/issues?limit=5',
      headers: { 'x-mock-latency': '0' },
    });
    assert.equal(first.statusCode, 200);
    const firstBody = first.json();
    assert.ok(Array.isArray(firstBody.items));
    assert.equal(firstBody.items.length, 5);
    assert.ok('nextCursor' in firstBody);

    const second = await app.inject({
      method: 'GET',
      url: `/v1/issues?limit=5&cursor=${encodeURIComponent(firstBody.nextCursor)}`,
      headers: { 'x-mock-latency': '0' },
    });
    assert.equal(second.statusCode, 200);
    const secondBody = second.json();
    const firstIds = new Set(firstBody.items.map((i: { id: string }) => i.id));
    for (const item of secondBody.items)
      assert.ok(!firstIds.has(item.id), 'page 2 must not repeat page 1 items');
  });
});

test('ADR 0006: every non-2xx response is application/problem+json with a stable code', async () => {
  await withApp(async (app) => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/issues/does-not-exist',
      headers: { 'x-mock-latency': '0' },
    });
    assert.equal(res.statusCode, 404);
    assert.match(res.headers['content-type'] as string, /application\/problem\+json/);
    const body = res.json();
    assert.equal(body.code, 'issue.not_found');
    assert.equal(typeof body.title, 'string');
  });
});

test('ADR 0006: PATCH without If-Match is rejected (428/400), stale If-Match is 409, correct If-Match succeeds', async () => {
  await withApp(async (app) => {
    const detail = await app.inject({
      method: 'GET',
      url: '/v1/issues/issue-0',
      headers: { 'x-mock-latency': '0' },
    });
    assert.equal(detail.statusCode, 200);
    const etag = detail.headers.etag as string;
    assert.ok(etag);

    const withoutIfMatch = await app.inject({
      method: 'PATCH',
      url: '/v1/issues/issue-0',
      headers: { 'x-mock-latency': '0' },
      payload: { ownerUserId: 'user-analyst-1' },
    });
    assert.equal(withoutIfMatch.statusCode, 400);

    const staleIfMatch = await app.inject({
      method: 'PATCH',
      url: '/v1/issues/issue-0',
      headers: { 'x-mock-latency': '0', 'if-match': '"stale-etag"' },
      payload: { ownerUserId: 'user-analyst-1' },
    });
    assert.equal(staleIfMatch.statusCode, 409);
    assert.equal(staleIfMatch.json().code, 'concurrency.stale_resource');

    const correctIfMatch = await app.inject({
      method: 'PATCH',
      url: '/v1/issues/issue-0',
      headers: { 'x-mock-latency': '0', 'if-match': etag },
      payload: { ownerUserId: 'user-analyst-1' },
    });
    assert.equal(correctIfMatch.statusCode, 200);
    assert.equal(correctIfMatch.json().ownerUserId, 'user-analyst-1');
  });
});

test('ADR 0006: Idempotency-Key replay returns the original response rather than creating a second resource', async () => {
  await withApp(async (app) => {
    const headers = { 'x-mock-latency': '0', 'idempotency-key': 'replay-test-1' };
    const first = await app.inject({
      method: 'POST',
      url: '/v1/verification-scans',
      headers,
      payload: { issueId: 'issue-0' },
    });
    const second = await app.inject({
      method: 'POST',
      url: '/v1/verification-scans',
      headers,
      payload: { issueId: 'issue-0' },
    });
    assert.equal(first.statusCode, 202);
    assert.deepEqual(first.json(), second.json());
  });
});

test('P1-23/SEC-13 mock approximation: insufficient role is rejected with 403', async () => {
  await withApp(async (app) => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/users',
      headers: { 'x-mock-latency': '0', 'x-mock-role': 'viewer', 'idempotency-key': 'perm-test-1' },
      payload: {
        email: 'new@example.com',
        displayName: 'New',
        role: 'viewer',
        password: 'password123',
      },
    });
    assert.equal(res.statusCode, 403);
    assert.equal(res.json().code, 'auth.insufficient_role');
  });
});

test('SEC-12: unknown/missing required fields are rejected at the API boundary, not silently accepted', async () => {
  await withApp(async (app) => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/users',
      headers: { 'x-mock-latency': '0', 'idempotency-key': 'validation-test-1' },
      payload: { email: 'missing-fields@example.com' },
    });
    assert.equal(res.statusCode, 400);
    assert.equal(res.json().code, 'validation.schema_violation');
  });
});

test('Step 2.4: X-Mock-Force-Status simulates a deterministic partial failure', async () => {
  await withApp(async (app) => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/dashboard',
      headers: { 'x-mock-latency': '0', 'x-mock-force-status': '503' },
    });
    assert.equal(res.statusCode, 503);
    assert.equal(res.json().code, 'mock.simulated_failure');
  });
});

test('MOD-13: verified_resolved cannot be set via a manual transition — system-only, rejected at the schema boundary itself', async () => {
  await withApp(async (app) => {
    const detail = await app.inject({
      method: 'GET',
      url: '/v1/issues/issue-0',
      headers: { 'x-mock-latency': '0' },
    });
    const etag = detail.headers.etag as string;
    const res = await app.inject({
      method: 'POST',
      url: '/v1/issues/issue-0/transitions',
      headers: { 'x-mock-latency': '0', 'if-match': etag },
      payload: { toState: 'verified_resolved' },
    });
    // verified_resolved is excluded from IssueTransitionRequest.toState's enum entirely (openapi.yaml) —
    // stronger than an app-level check, since a schema violation never reaches business logic at all.
    assert.equal(res.statusCode, 400);
    assert.equal(res.json().code, 'validation.schema_violation');
  });
});

test('MOD-11: false_positive requires a reason code and justification', async () => {
  await withApp(async (app) => {
    const detail = await app.inject({
      method: 'GET',
      url: '/v1/issues/issue-0',
      headers: { 'x-mock-latency': '0' },
    });
    const etag = detail.headers.etag as string;
    const res = await app.inject({
      method: 'POST',
      url: '/v1/issues/issue-0/transitions',
      headers: { 'x-mock-latency': '0', 'if-match': etag },
      payload: { toState: 'false_positive' },
    });
    assert.equal(res.statusCode, 422);
    assert.equal(res.json().code, 'issue.false_positive_requires_reason');
  });
});

test('MOD-12: exception expiry beyond the 365-day GATE 1-accepted maximum is rejected', async () => {
  await withApp(async (app) => {
    const farFuture = new Date(Date.now() + 400 * 86_400_000).toISOString();
    const res = await app.inject({
      method: 'POST',
      url: '/v1/exceptions',
      headers: { 'x-mock-latency': '0', 'idempotency-key': 'exc-test-1' },
      payload: { issueId: 'issue-0', justification: 'test', expiresAt: farFuture },
    });
    assert.equal(res.statusCode, 422);
    assert.equal(res.json().code, 'exception.expiry_exceeds_maximum');
  });
});

test('SAFE-08: scan-plan preview then scan-run creation returns 202 with a Location header (never blocks on execution)', async () => {
  await withApp(async (app) => {
    const scopesRes = await app.inject({
      method: 'GET',
      url: '/v1/authorized-scopes?limit=1',
      headers: { 'x-mock-latency': '0' },
    });
    const profilesRes = await app.inject({
      method: 'GET',
      url: '/v1/scan-profiles',
      headers: { 'x-mock-latency': '0' },
    });
    const scopeId = scopesRes.json().items[0].id;
    const safeProfile = profilesRes
      .json()
      .find((p: { intrusiveness: string }) => p.intrusiveness === 'safe');

    const plan = await app.inject({
      method: 'POST',
      url: '/v1/scan-plans',
      headers: { 'x-mock-latency': '0', 'idempotency-key': 'plan-1' },
      payload: { scopeId, profileId: safeProfile.id },
    });
    assert.equal(plan.statusCode, 201);

    const run = await app.inject({
      method: 'POST',
      url: '/v1/scan-runs',
      headers: { 'x-mock-latency': '0', 'idempotency-key': 'run-1' },
      payload: { planPreviewId: plan.json().id, confirm: true },
    });
    assert.equal(run.statusCode, 202);
    assert.ok(run.headers.location);
  });
});

test('full login -> MFA -> session flow works end to end', async () => {
  await withApp(async (app) => {
    const login = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      headers: { 'x-mock-latency': '0' },
      payload: { email: 'admin@pilot-customer.example', password: 'password123' },
    });
    assert.equal(login.statusCode, 200);
    assert.equal(login.json().mfaRequired, true);

    const challenge = await app.inject({
      method: 'POST',
      url: '/v1/auth/mfa/challenge',
      headers: { 'x-mock-latency': '0' },
      payload: { challengeToken: login.json().challengeToken, code: '000000' },
    });
    assert.equal(challenge.statusCode, 200);
    const setCookie = challenge.headers['set-cookie'];
    assert.ok(setCookie);
    const cookieHeader = Array.isArray(setCookie) ? setCookie[0]! : setCookie;

    const session = await app.inject({
      method: 'GET',
      url: '/v1/auth/session',
      headers: { 'x-mock-latency': '0', cookie: cookieHeader.split(';')[0]! },
    });
    assert.equal(session.statusCode, 200);
    assert.equal(session.json().user.email, 'admin@pilot-customer.example');
  });
});
