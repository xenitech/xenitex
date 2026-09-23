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

test(
  'full login -> /auth/session -> logout flow against a real user row',
  { skip: !RUN },
  async (t) => {
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
    t.after(() => retireTestUser(userId));

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
  async (t) => {
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
    t.after(() => retireTestUser(userId));

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

test(
  'an account is locked out after repeated failed logins (SEC-11)',
  { skip: !RUN },
  async (t) => {
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
    t.after(() => retireTestUser(userId));

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
  },
);

/**
 * SEC-09, end to end against a real Postgres and Redis.
 *
 * Two halves, and the second matters as much as the first: the gate must
 * block a privileged account that has not enrolled TOTP, AND it must still
 * allow the handful of routes that let that account enrol. An allowlist
 * that silently fails to match turns the control into a permanent lockout
 * — the operator can sign in, and then cannot reach a single route,
 * including the enrolment endpoints. That is how this was first written
 * (the allowlist compared post-prefix paths against `routeOptions.url`,
 * which carries the `/v1` prefix) and nothing caught it.
 */
test('SEC-09: an unenrolled operator is gated everywhere except the routes that let them enrol', async (t) => {
  if (!RUN) return t.skip('DATABASE_URL/REDIS_URL not set');
  // Pinned explicitly rather than inherited from the ambient environment:
  // this deployment may be configured MFA_ENFORCEMENT=optional, and a
  // security test that quietly becomes a no-op because of a config value is
  // worse than no test. The companion test below covers `optional`.
  const app = buildServer({ ...deps, mfaEnforcement: 'mandatory' });
  const email = `mfa-gate-${randomUUID()}@test.local`;
  const password = 'Gate-Test-Password-2026';
  const userId = newId();

  await db
    .insertInto('users')
    .values({
      id: userId,
      email,
      display_name: 'MFA gate test',
      role: 'operator',
      password_hash: await hashPassword(password),
      mfa_enabled: false,
      is_active: true,
    })
    .execute();
  // Retired, not deleted. `audit_entries.session_id` references the sessions
  // this account generates, and that log is append-only by design (DATA-02),
  // so Postgres refuses to delete them — which is exactly the behaviour we
  // want and exactly what a test must not fight. Revoking the session and
  // deactivating the account leaves no usable credential behind while
  // keeping the audit history intact.
  t.after(() => retireTestUser(userId));

  // A distinct source address per test. SEC-11's per-source limiter is
  // Redis-backed and shared across the whole file, and the lockout test
  // above deliberately burns eight attempts from the default inject
  // address — without this, whichever test runs next gets a 429 that has
  // nothing to do with what it is measuring.
  const remoteAddress = '10.77.0.9';
  const login = await app.inject({
    method: 'POST',
    url: '/v1/auth/login',
    remoteAddress,
    payload: { email, password },
  });
  assert.equal(login.statusCode, 200, 'credentials alone still establish a session');
  const sessionToken = extractCookie(login.headers['set-cookie'], 'xenitex_session');
  const csrfToken = extractCookie(login.headers['set-cookie'], 'xenitex_csrf');
  assert.ok(sessionToken && csrfToken);
  const cookie = `xenitex_session=${sessionToken}; xenitex_csrf=${csrfToken}`;

  // Blocked: anything that is not part of clearing the gate.
  for (const url of ['/v1/issues', '/v1/assets', '/v1/scan-runs', '/v1/users']) {
    const response = await app.inject({ method: 'GET', url, headers: { cookie } });
    assert.equal(response.statusCode, 403, `${url} must be gated`);
    assert.equal(response.json().code, 'auth.mfa_enrollment_required', `${url} gate code`);
  }

  // Allowed: the way out. Without these the account is bricked.
  const session = await app.inject({ method: 'GET', url: '/v1/auth/session', headers: { cookie } });
  assert.equal(
    session.statusCode,
    200,
    'the panel must be able to read the session to show the enrol screen',
  );

  const enroll = await app.inject({
    method: 'POST',
    url: '/v1/auth/mfa/enroll',
    headers: { cookie, 'x-csrf-token': csrfToken! },
  });
  assert.equal(enroll.statusCode, 200, 'enrolment must be reachable while gated');
  const { enrollmentToken, secret } = enroll.json();
  assert.ok(enrollmentToken && secret);

  // Completing enrolment must lift the gate on the very next request.
  const confirm = await app.inject({
    method: 'POST',
    url: '/v1/auth/mfa/enroll/confirm',
    headers: { cookie, 'x-csrf-token': csrfToken! },
    payload: {
      enrollmentToken,
      code: new OTPAuth.TOTP({
        issuer: 'Xenitex',
        label: email,
        algorithm: 'SHA1',
        digits: 6,
        period: 30,
        secret: OTPAuth.Secret.fromBase32(secret),
      }).generate(),
    },
  });
  assert.equal(confirm.statusCode, 200, 'enrolment confirmation');

  const afterEnrolment = await app.inject({
    method: 'GET',
    url: '/v1/issues',
    headers: { cookie },
  });
  assert.equal(afterEnrolment.statusCode, 200, 'the gate lifts as soon as TOTP is enrolled');

  // And re-enrolment is refused, so a stolen session cannot displace the
  // real owner's authenticator.
  const reEnroll = await app.inject({
    method: 'POST',
    url: '/v1/auth/mfa/enroll',
    headers: { cookie, 'x-csrf-token': csrfToken! },
  });
  assert.equal(reEnroll.statusCode, 409);
  assert.equal(reEnroll.json().code, 'auth.mfa_already_enrolled');
});

test('a deactivated account cannot keep using an already-issued session', async (t) => {
  if (!RUN) return t.skip('DATABASE_URL/REDIS_URL not set');
  const app = buildServer(deps);
  const email = `deactivated-${randomUUID()}@test.local`;
  const password = 'Deactivation-Test-2026';
  const userId = newId();

  await db
    .insertInto('users')
    .values({
      id: userId,
      email,
      display_name: 'Deactivation test',
      role: 'viewer', // viewer is outside MFA_MANDATORY_ROLES, so the MFA gate is not what we are measuring here
      password_hash: await hashPassword(password),
      mfa_enabled: false,
      is_active: true,
    })
    .execute();
  // Retired, not deleted. `audit_entries.session_id` references the sessions
  // this account generates, and that log is append-only by design (DATA-02),
  // so Postgres refuses to delete them — which is exactly the behaviour we
  // want and exactly what a test must not fight. Revoking the session and
  // deactivating the account leaves no usable credential behind while
  // keeping the audit history intact.
  t.after(() => retireTestUser(userId));

  // Distinct source address — see the note in the SEC-09 test above.
  const login = await app.inject({
    method: 'POST',
    url: '/v1/auth/login',
    remoteAddress: '10.77.0.10',
    payload: { email, password },
  });
  assert.equal(login.statusCode, 200);
  const cookie = `xenitex_session=${extractCookie(login.headers['set-cookie'], 'xenitex_session')}`;

  assert.equal(
    (await app.inject({ method: 'GET', url: '/v1/issues', headers: { cookie } })).statusCode,
    200,
    'sanity: the session works while the account is active',
  );

  await db.updateTable('users').set({ is_active: false }).where('id', '=', userId).execute();

  const afterDeactivation = await app.inject({
    method: 'GET',
    url: '/v1/issues',
    headers: { cookie },
  });
  assert.equal(afterDeactivation.statusCode, 401, 'deactivation takes effect on the next request');
});

/**
 * The `optional` half of the same control (MFA_ENFORCEMENT=optional).
 *
 * Turning the enrolment gate off is a legitimate operator decision, but it
 * must weaken exactly one thing and nothing else. In particular, "optional"
 * means optional to *start* — the moment an account has enrolled, its TOTP
 * challenge is required at every login and there is no path back around it.
 * A configuration flag that also let an enrolled user skip their second
 * factor would be a far worse defect than the gate it disables.
 */
test('MFA_ENFORCEMENT=optional lifts the enrolment gate but never weakens an enrolled account', async (t) => {
  if (!RUN) return t.skip('DATABASE_URL/REDIS_URL not set');
  const app = buildServer({ ...deps, mfaEnforcement: 'optional' });
  const email = `mfa-optional-${randomUUID()}@test.local`;
  const password = 'Optional-Mode-Password-2026';
  const userId = newId();

  await db
    .insertInto('users')
    .values({
      id: userId,
      email,
      display_name: 'MFA optional test',
      role: 'administrator',
      password_hash: await hashPassword(password),
      mfa_enabled: false,
      is_active: true,
    })
    .execute();
  t.after(() => retireTestUser(userId));

  const login = await app.inject({
    method: 'POST',
    url: '/v1/auth/login',
    remoteAddress: '10.77.0.11',
    payload: { email, password },
  });
  assert.equal(login.statusCode, 200);
  const csrfToken = extractCookie(login.headers['set-cookie'], 'xenitex_csrf')!;
  const cookie = `xenitex_session=${extractCookie(login.headers['set-cookie'], 'xenitex_session')}; xenitex_csrf=${csrfToken}`;

  // No gate: an unenrolled administrator can work immediately.
  assert.equal(
    (await app.inject({ method: 'GET', url: '/v1/issues', headers: { cookie } })).statusCode,
    200,
    'the enrolment gate must be lifted',
  );

  // The server must also tell the panel not to present the enrolment wall.
  const session = await app.inject({ method: 'GET', url: '/v1/auth/session', headers: { cookie } });
  assert.equal(session.json().capabilities['auth.mfaEnrollmentRequired'], false);
  assert.equal(
    session.json().capabilities['auth.mfaEnrollmentAvailable'],
    true,
    'voluntary enrolment must still be offered',
  );

  // Voluntary enrolment still works end to end.
  const enroll = await app.inject({
    method: 'POST',
    url: '/v1/auth/mfa/enroll',
    headers: { cookie, 'x-csrf-token': csrfToken },
  });
  assert.equal(enroll.statusCode, 200);
  const { enrollmentToken, secret } = enroll.json();
  const totp = new OTPAuth.TOTP({
    issuer: 'Xenitex',
    label: email,
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(secret),
  });
  const confirm = await app.inject({
    method: 'POST',
    url: '/v1/auth/mfa/enroll/confirm',
    headers: { cookie, 'x-csrf-token': csrfToken },
    payload: { enrollmentToken, code: totp.generate() },
  });
  assert.equal(confirm.statusCode, 200);
  assert.equal(confirm.json().recoveryCodes.length, 8);

  // The point of the whole test: having opted in, this account is now held
  // to it. A fresh login gets a challenge, not a session, even though the
  // appliance is running in `optional` mode.
  const secondLogin = await app.inject({
    method: 'POST',
    url: '/v1/auth/login',
    remoteAddress: '10.77.0.11',
    payload: { email, password },
  });
  assert.equal(secondLogin.statusCode, 200);
  assert.equal(
    secondLogin.json().mfaRequired,
    true,
    'an enrolled account must still be challenged under optional enforcement',
  );
  assert.equal(
    extractCookie(secondLogin.headers['set-cookie'], 'xenitex_session'),
    undefined,
    'no session may be issued before the TOTP challenge is answered',
  );
});
