import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import * as OTPAuth from 'otpauth';
import { after, before, test } from 'node:test';
import type { DB } from '@xenitex/db';
import { newId } from '@xenitex/domain';
import type { Kysely } from 'kysely';
import { hashPassword } from '../auth/passwords.js';
import { buildDependencies, closeDependencies, type ApiDependencies } from '../dependencies.js';
import { loadConfig } from '../config.js';
import { buildServer } from '../server.js';

const RUN = Boolean(process.env.DATABASE_URL && process.env.REDIS_URL);

let deps: ApiDependencies;
let db: Kysely<DB>;

before(async () => {
  if (!RUN) {
    console.log('DATABASE_URL/REDIS_URL not set — skipping apps/api setup integration tests.');
    return;
  }
  deps = buildDependencies(loadConfig(process.env));
  db = deps.db;
});

/**
 * Every user this file creates, retired together when it finishes. Placing
 * cleanup here rather than in each test means a test added later gets it
 * for free — which matters, because the accounts these helpers create are
 * real, active, and carry a password written in plain text in this file.
 */
const createdUserIds: string[] = [];

after(async () => {
  if (!RUN) return;
  for (const userId of createdUserIds) await retireTestUser(userId);
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

/**
 * Integration tests create real user rows against a real database, and
 * `audit_entries.session_id` pins the sessions they generate — so the rows
 * cannot be deleted, and an earlier version of these tests simply left them
 * behind. Sixty active accounts accumulated in one development appliance
 * that way, every one of them carrying a password that is written in plain
 * text a few lines above in this file.
 *
 * Retiring them is the same thing the product does to a real account it no
 * longer wants: revoke the sessions, burn the recovery codes, deactivate,
 * and overwrite the hash with a value no password can produce. The audit
 * history stays intact, and nothing usable is left behind.
 */
async function retireTestUser(userId: string): Promise<void> {
  await db
    .updateTable('sessions')
    .set({ revoked_at: new Date(), revoked_reason: 'test teardown' })
    .where('user_id', '=', userId)
    .where('revoked_at', 'is', null)
    .execute();
  await db
    .updateTable('mfa_recovery_codes')
    .set({ used_at: new Date() })
    .where('user_id', '=', userId)
    .where('used_at', 'is', null)
    .execute();
  await db
    .updateTable('users')
    .set({ is_active: false, password_hash: '!disabled', mfa_secret_ref: null })
    .where('id', '=', userId)
    .execute();
}

// organization_settings (id=1) and "does any administrator exist" are
// singleton/shared facts across the whole dev database, not per-test
// fixtures -- these tests establish an administrator session directly via
// DB insert + /auth/login (never via /setup/administrator, which must 409
// once one exists) and then drive the rest of the wizard through that
// session, same shared-state posture as audit-log.integration.test.ts.
async function ensureAdministratorSession(app: ReturnType<typeof buildServer>) {
  const email = `setup-admin-${randomUUID()}@example.test`;
  const password = 'correct-horse-battery-staple';
  // TOTP enrolled from the start: SEC-09 makes it mandatory for this role
  // and apps/api enforces it on every request, so an administrator row
  // without it cannot reach any of the wizard steps below.
  const secret = new OTPAuth.Secret({ size: 20 }).base32;
  const userId = newId();
  await db
    .insertInto('users')
    .values({
      id: userId,
      email,
      display_name: 'Setup Test Administrator',
      password_hash: await hashPassword(password),
      role: 'administrator',
      mfa_enabled: true,
      mfa_secret_ref: secret,
    })
    .execute();
  createdUserIds.push(userId);

  const loginResponse = await app.inject({
    method: 'POST',
    url: '/v1/auth/login',
    // Own address, distinct from other test files' default 127.0.0.1 and
    // from resources.integration.test.ts's 10.99.1.1 -- see that file's
    // comment on why sharing SEC-11's IP-keyed rate-limit bucket across
    // files causes spurious 429s once enough of them run together.
    remoteAddress: '10.99.1.2',
    payload: { email, password },
  });
  assert.equal(loginResponse.statusCode, 200);
  assert.equal(loginResponse.json().mfaRequired, true);

  const challengeResponse = await app.inject({
    method: 'POST',
    url: '/v1/auth/mfa/challenge',
    remoteAddress: '10.99.1.2',
    payload: {
      challengeToken: loginResponse.json().challengeToken,
      code: new OTPAuth.TOTP({
        issuer: 'Xenitex',
        label: email,
        algorithm: 'SHA1',
        digits: 6,
        period: 30,
        secret,
      }).generate(),
    },
  });
  assert.equal(challengeResponse.statusCode, 200);
  const sessionCookie = extractCookie(challengeResponse.headers['set-cookie'], 'xenitex_session');
  const csrfCookie = extractCookie(challengeResponse.headers['set-cookie'], 'xenitex_csrf');
  assert.ok(sessionCookie);
  assert.ok(csrfCookie);
  return {
    userId,
    cookie: `xenitex_session=${sessionCookie}; xenitex_csrf=${csrfCookie}`,
    csrfHeader: csrfCookie!,
  };
}

test(
  'POST /setup/administrator is refused once an administrator exists',
  { skip: !RUN },
  async () => {
    const app = buildServer(deps);
    await ensureAdministratorSession(app); // guarantees at least one exists

    const response = await app.inject({
      method: 'POST',
      url: '/v1/setup/administrator',
      payload: {
        email: `second-${randomUUID()}@example.test`,
        displayName: 'Second Admin',
        password: 'correct-horse-battery-staple',
      },
    });
    assert.equal(response.statusCode, 409);
    assert.equal(response.json().code, 'setup.already_initialized');
  },
);

test('setup wizard steps require a session', { skip: !RUN }, async () => {
  const app = buildServer(deps);
  const response = await app.inject({
    method: 'POST',
    url: '/v1/setup/organization',
    payload: { organizationName: 'Nope', timezone: 'UTC' },
  });
  assert.equal(response.statusCode, 401);
});

test(
  'organization -> tls -> initial-scope -> safety -> complete, driven by an authenticated administrator',
  { skip: !RUN },
  async () => {
    const app = buildServer(deps);
    const { cookie, csrfHeader } = await ensureAdministratorSession(app);
    const headers = { cookie, 'x-csrf-token': csrfHeader };

    const orgResponse = await app.inject({
      method: 'POST',
      url: '/v1/setup/organization',
      headers,
      payload: { organizationName: 'Pilot Co', timezone: 'UTC' },
    });
    assert.equal(orgResponse.statusCode, 204);

    const tlsResponse = await app.inject({
      method: 'POST',
      url: '/v1/setup/tls',
      headers,
      payload: { tlsMode: 'self_signed' },
    });
    assert.equal(tlsResponse.statusCode, 204);

    const scopeResponse = await app.inject({
      method: 'POST',
      url: '/v1/setup/initial-scope',
      headers,
      payload: {
        name: `Pilot scope ${randomUUID()}`,
        cidrRanges: ['10.0.0.0/24'],
        hostnames: [],
        attestationType: 'self_attested_owner',
        attestationDetails: 'I own this network',
      },
    });
    assert.equal(scopeResponse.statusCode, 201);
    assert.deepEqual(scopeResponse.json().cidrRanges, ['10.0.0.0/24']);

    const safetyResponse = await app.inject({
      method: 'POST',
      url: '/v1/setup/safety-acknowledgement',
      headers,
    });
    assert.equal(safetyResponse.statusCode, 204);

    const statusResponse = await app.inject({ method: 'GET', url: '/v1/setup/status' });
    const status = statusResponse.json();
    assert.equal(status.administratorCreated, true);
    assert.equal(status.organizationConfigured, true);
    assert.equal(status.tlsConfigured, true);
    assert.equal(status.initialScopeDeclared, true);
    assert.equal(status.safetyAcknowledged, true);

    const completeResponse = await app.inject({
      method: 'POST',
      url: '/v1/setup/complete',
      headers,
    });
    assert.equal(completeResponse.statusCode, 204);

    const finalStatus = await app.inject({ method: 'GET', url: '/v1/setup/status' });
    assert.equal(finalStatus.json().setupCompleted, true);

    // Idempotent: calling it again after completion must not error.
    const secondComplete = await app.inject({
      method: 'POST',
      url: '/v1/setup/complete',
      headers,
    });
    assert.equal(secondComplete.statusCode, 204);
  },
);
