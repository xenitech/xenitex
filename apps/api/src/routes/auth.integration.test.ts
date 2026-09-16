import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import type { DB } from '@xenitex/db';
import { newId } from '@xenitex/domain';
import type { Kysely } from 'kysely';
import * as OTPAuth from 'otpauth';
import { hashPassword } from '../auth/passwords.js';
import { buildDependencies, closeDependencies, type ApiDependencies } from '../dependencies.js';
import { loadConfig } from '../config.js';
import { buildServer } from '../server.js';

const RUN = Boolean(process.env.DATABASE_URL && process.env.REDIS_URL);

let deps: ApiDependencies;
let db: Kysely<DB>;

before(async () => {
  if (!RUN) {
    console.log('DATABASE_URL/REDIS_URL not set — skipping apps/api auth integration tests.');
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

test(
  'full login -> /auth/session -> logout flow against a real user row',
  { skip: !RUN },
  async () => {
    const app = buildServer(deps);
    const email = `test-${randomUUID()}@example.test`;
    const password = 'correct-horse-battery-staple';
    const userId = newId();

    await db
      .insertInto('users')
      .values({
        id: userId,
        email,
        display_name: 'Test User',
        password_hash: await hashPassword(password),
        role: 'analyst',
      })
      .execute();

    const loginResponse = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email, password },
    });
    assert.equal(loginResponse.statusCode, 200);
    const sessionCookie = extractCookie(loginResponse.headers['set-cookie'], 'xenitex_session');
    const csrfCookie = extractCookie(loginResponse.headers['set-cookie'], 'xenitex_csrf');
    assert.ok(sessionCookie, 'expected a session cookie to be set');
    assert.ok(csrfCookie, 'expected a CSRF cookie to be set');
    assert.equal(loginResponse.json().user.email, email);
    assert.equal(
      loginResponse.json().capabilities['issues.write'],
      true,
      'analyst role should have issues.write',
    );

    const sessionResponse = await app.inject({
      method: 'GET',
      url: '/v1/auth/session',
      headers: { cookie: `xenitex_session=${sessionCookie}` },
    });
    assert.equal(sessionResponse.statusCode, 200);
    assert.equal(sessionResponse.json().user.id, userId);

    // A mutating request without the CSRF header must be rejected (SEC-08 double-submit).
    const noCsrfResponse = await app.inject({
      method: 'POST',
      url: '/v1/auth/logout',
      headers: { cookie: `xenitex_session=${sessionCookie}` },
    });
    assert.equal(noCsrfResponse.statusCode, 403);

    const logoutResponse = await app.inject({
      method: 'POST',
      url: '/v1/auth/logout',
      headers: { cookie: `xenitex_session=${sessionCookie}`, 'x-csrf-token': csrfCookie! },
    });
    assert.equal(logoutResponse.statusCode, 204);

    const afterLogout = await app.inject({
      method: 'GET',
      url: '/v1/auth/session',
      headers: { cookie: `xenitex_session=${sessionCookie}` },
    });
    assert.equal(afterLogout.statusCode, 401, 'a revoked session must no longer authenticate');
  },
);

test(
  'MFA-enabled user must complete a TOTP challenge before a session is issued',
  { skip: !RUN },
  async () => {
    const app = buildServer(deps);
    const email = `test-mfa-${randomUUID()}@example.test`;
    const password = 'correct-horse-battery-staple';
    const secret = new OTPAuth.Secret({ size: 20 }).base32;
    const userId = newId();

    await db
      .insertInto('users')
      .values({
        id: userId,
        email,
        display_name: 'MFA Test User',
        password_hash: await hashPassword(password),
        role: 'operator',
        mfa_enabled: true,
        mfa_secret_ref: secret,
      })
      .execute();

    const loginResponse = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email, password },
    });
    assert.equal(loginResponse.statusCode, 200);
    assert.equal(loginResponse.json().mfaRequired, true);
    const { challengeToken } = loginResponse.json();

    const totp = new OTPAuth.TOTP({
      issuer: 'Xenitex',
      label: email,
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      secret,
    });
    const code = totp.generate();

    const challengeResponse = await app.inject({
      method: 'POST',
      url: '/v1/auth/mfa/challenge',
      payload: { challengeToken, code },
    });
    assert.equal(challengeResponse.statusCode, 200);
    assert.equal(challengeResponse.json().user.id, userId);
    assert.ok(extractCookie(challengeResponse.headers['set-cookie'], 'xenitex_session'));

    // The same challenge token must not be usable twice (single-use).
    const replay = await app.inject({
      method: 'POST',
      url: '/v1/auth/mfa/challenge',
      payload: { challengeToken, code },
    });
    assert.equal(replay.statusCode, 401);
  },
);

test('an account is locked out after repeated failed logins (SEC-11)', { skip: !RUN }, async () => {
  const app = buildServer(deps);
  const email = `test-lockout-${randomUUID()}@example.test`;
  const userId = newId();

  await db
    .insertInto('users')
    .values({
      id: userId,
      email,
      display_name: 'Lockout Test User',
      password_hash: await hashPassword('correct-horse-battery-staple'),
      role: 'viewer',
    })
    .execute();

  let lastStatus = 0;
  for (let i = 0; i < 6; i++) {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email, password: 'wrong-password' },
    });
    lastStatus = response.statusCode;
  }
  assert.equal(lastStatus, 423, 'the account should be locked after enough failures');

  // Even the CORRECT password is rejected while locked.
  const stillLocked = await app.inject({
    method: 'POST',
    url: '/v1/auth/login',
    payload: { email, password: 'correct-horse-battery-staple' },
  });
  assert.equal(stillLocked.statusCode, 423);
});
