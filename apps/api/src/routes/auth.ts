import type { FastifyInstance, FastifyRequest } from 'fastify';
import { newId } from '@xenitex/domain';
import type { ApiDependencies } from '../dependencies.js';
import { appendAuditEntry } from '../audit/audit-log.js';
import { capabilitiesFor } from '../auth/capabilities.js';
import {
  consumeMfaChallenge,
  consumePendingEnrollment,
  createMfaChallenge,
  createPendingEnrollment,
} from '../auth/challenge-store.js';
import { hashPassword, validatePasswordPolicy, verifyPassword } from '../auth/passwords.js';
import {
  ACCOUNT_LOCKOUT_DURATION_MINUTES,
  ACCOUNT_LOCKOUT_THRESHOLD,
  isSourceAddressRateLimited,
} from '../auth/rate-limit.js';
import {
  createSession,
  resolveSession,
  revokeAllSessionsForUser,
  revokeSession,
  verifyCsrfToken,
} from '../auth/sessions.js';
import {
  generateRecoveryCodes,
  generateTotpSecret,
  totpProvisioningUri,
  verifyTotpCode,
} from '../auth/totp.js';
import { createHash } from 'node:crypto';

const SESSION_COOKIE = 'xenitex_session';
const CSRF_COOKIE = 'xenitex_csrf';

export function sourceAddressOf(request: FastifyRequest): string {
  return request.ip;
}

export function problem(status: number, code: string, title: string, detail?: string) {
  return {
    type: `https://xenitex.internal/problems/${code.replaceAll('.', '/')}`,
    title,
    status,
    code,
    ...(detail ? { detail } : {}),
  };
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export async function registerAuthRoutes(
  app: FastifyInstance,
  deps: ApiDependencies,
): Promise<void> {
  const { db, redis } = deps;

  app.post('/auth/login', async (request, reply) => {
    const body = request.body as { email?: string; password?: string };
    const sourceAddress = sourceAddressOf(request);

    if (await isSourceAddressRateLimited(redis, sourceAddress)) {
      return reply
        .code(429)
        .type('application/problem+json')
        .send(problem(429, 'auth.rate_limited', 'Too many requests'));
    }

    if (!body?.email || !body.password) {
      return reply
        .code(400)
        .type('application/problem+json')
        .send(problem(400, 'validation.schema_violation', 'email and password are required'));
    }

    const user = await db
      .selectFrom('users')
      .selectAll()
      .where('email', '=', body.email)
      .executeTakeFirst();

    // Checked before the password, and regardless of whether this attempt's
    // password happens to be correct: once locked, every attempt gets 423
    // until the lock expires. Checking this only on the correct-password
    // path (i.e. after verifyPassword) was a real bug — a locked-out
    // attacker retrying with a wrong password would otherwise fall through
    // to the generic 401 below and never see the lock, and (worse) each
    // such attempt would keep extending failed_login_count/locked_until as
    // if the lock weren't already in effect.
    if (user?.locked_until && new Date(user.locked_until) > new Date()) {
      await db
        .insertInto('auth_events')
        .values({
          actor_identifier: body.email,
          event_type: 'lockout',
          source_address: sourceAddress,
          metadata: {} as never,
        })
        .execute();
      return reply
        .code(423)
        .type('application/problem+json')
        .send(problem(423, 'auth.locked_out', 'Account is temporarily locked'));
    }

    // Constant-shape failure: a nonexistent account and a wrong password
    // both end up at the same 401 with the same timing-relevant work done
    // (argon2.verify runs either way, against a fixed dummy hash when there
    // is no real user) — this is what stops account enumeration via
    // response-time or response-shape differences.
    const DUMMY_HASH =
      '$argon2id$v=19$m=19456,t=2,p=1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
    const passwordOk = await verifyPassword(user?.password_hash ?? DUMMY_HASH, body.password);

    if (!user || !passwordOk || !user.is_active) {
      if (user) {
        const failedCount = user.failed_login_count + 1;
        const lockedUntil =
          failedCount >= ACCOUNT_LOCKOUT_THRESHOLD
            ? new Date(Date.now() + ACCOUNT_LOCKOUT_DURATION_MINUTES * 60_000)
            : user.locked_until;
        await db
          .updateTable('users')
          .set({ failed_login_count: failedCount, locked_until: lockedUntil })
          .where('id', '=', user.id)
          .execute();
        await db
          .insertInto('auth_events')
          .values({
            actor_identifier: body.email,
            event_type: 'login_failure',
            source_address: sourceAddress,
            metadata: {} as never,
          })
          .execute();
        await appendAuditEntry(db, {
          actorUserId: null,
          sessionId: null,
          sourceAddress,
          action: 'auth.login_failure',
          targetType: 'user',
          targetId: user.id,
          beforeState: null,
          afterState: null,
          outcome: 'failure',
        });
      }
      return reply
        .code(401)
        .type('application/problem+json')
        .send(problem(401, 'auth.invalid_credentials', 'Incorrect email or password'));
    }

    // Successful credential check resets the failure counter regardless of what happens next (MFA challenge or full session).
    await db
      .updateTable('users')
      .set({ failed_login_count: 0, locked_until: null })
      .where('id', '=', user.id)
      .execute();

    if (user.mfa_enabled) {
      const challengeToken = await createMfaChallenge(redis, user.id);
      return reply.code(200).send({ mfaRequired: true, challengeToken });
    }

    return completeLogin(deps, request, reply, user.id, sourceAddress);
  });

  app.post('/auth/mfa/challenge', async (request, reply) => {
    const body = request.body as { challengeToken?: string; code?: string };
    if (!body?.challengeToken || !body.code) {
      return reply
        .code(400)
        .type('application/problem+json')
        .send(problem(400, 'validation.schema_violation', 'challengeToken and code are required'));
    }
    const userId = await consumeMfaChallenge(redis, body.challengeToken);
    if (!userId) {
      return reply
        .code(401)
        .type('application/problem+json')
        .send(problem(401, 'auth.invalid_challenge', 'Challenge is invalid or expired'));
    }
    const user = await db
      .selectFrom('users')
      .selectAll()
      .where('id', '=', userId)
      .executeTakeFirst();
    if (!user || !user.mfa_secret_ref) {
      return reply
        .code(401)
        .type('application/problem+json')
        .send(problem(401, 'auth.invalid_challenge', 'Challenge is invalid or expired'));
    }

    const codeOk =
      verifyTotpCode(user.mfa_secret_ref, user.email, body.code) ||
      (await consumeRecoveryCode(db, user.id, body.code));
    if (!codeOk) {
      return reply
        .code(401)
        .type('application/problem+json')
        .send(problem(401, 'auth.invalid_code', 'Incorrect code'));
    }

    return completeLogin(deps, request, reply, user.id, sourceAddressOf(request));
  });

  app.post('/auth/mfa/enroll', { preHandler: requireSession(deps) }, async (request, reply) => {
    const currentUser = request.currentUser!;
    const secretBase32 = generateTotpSecret();
    const enrollmentToken = await createPendingEnrollment(redis, currentUser.userId, secretBase32);
    const user = await db
      .selectFrom('users')
      .select('email')
      .where('id', '=', currentUser.userId)
      .executeTakeFirstOrThrow();
    return reply.code(200).send({
      enrollmentToken,
      secret: secretBase32,
      qrCodeUri: totpProvisioningUri(secretBase32, user.email),
    });
  });

  app.post(
    '/auth/mfa/enroll/confirm',
    { preHandler: requireSession(deps) },
    async (request, reply) => {
      const body = request.body as { enrollmentToken?: string; code?: string };
      if (!body?.enrollmentToken || !body.code) {
        return reply
          .code(400)
          .type('application/problem+json')
          .send(
            problem(400, 'validation.schema_violation', 'enrollmentToken and code are required'),
          );
      }
      const pending = await consumePendingEnrollment(redis, body.enrollmentToken);
      if (!pending || pending.userId !== request.currentUser!.userId) {
        return reply
          .code(400)
          .type('application/problem+json')
          .send(
            problem(400, 'validation.schema_violation', 'Enrollment token is invalid or expired'),
          );
      }
      const user = await db
        .selectFrom('users')
        .select('email')
        .where('id', '=', pending.userId)
        .executeTakeFirstOrThrow();
      if (!verifyTotpCode(pending.secretBase32, user.email, body.code)) {
        return reply
          .code(400)
          .type('application/problem+json')
          .send(problem(400, 'validation.schema_violation', 'Incorrect TOTP code'));
      }

      const recoveryCodes = generateRecoveryCodes();
      await db.transaction().execute(async (trx) => {
        await trx
          .updateTable('users')
          .set({ mfa_enabled: true, mfa_secret_ref: pending.secretBase32 })
          .where('id', '=', pending.userId)
          .execute();
        for (const code of recoveryCodes) {
          await trx
            .insertInto('mfa_recovery_codes')
            .values({ id: newId(), user_id: pending.userId, code_hash: sha256Hex(code) })
            .execute();
        }
      });
      await appendAuditEntry(db, {
        actorUserId: pending.userId,
        sessionId: request.currentUser!.sessionId,
        sourceAddress: sourceAddressOf(request),
        action: 'auth.mfa_enrolled',
        targetType: 'user',
        targetId: pending.userId,
        beforeState: { mfaEnabled: false },
        afterState: { mfaEnabled: true },
        outcome: 'success',
      });

      return reply.code(200).send({ recoveryCodes });
    },
  );

  app.post(
    '/auth/logout',
    { preHandler: requireSession(deps, { optional: true }) },
    async (request, reply) => {
      if (request.currentUser) {
        await revokeSession(db, request.currentUser.sessionId, 'user_logout');
      }
      reply.clearCookie(SESSION_COOKIE, { path: '/' });
      reply.clearCookie(CSRF_COOKIE, { path: '/' });
      return reply.code(204).send();
    },
  );

  app.post('/auth/password', { preHandler: requireSession(deps) }, async (request, reply) => {
    const body = request.body as { currentPassword?: string; newPassword?: string };
    if (!body?.currentPassword || !body.newPassword) {
      return reply
        .code(400)
        .type('application/problem+json')
        .send(
          problem(
            400,
            'validation.schema_violation',
            'currentPassword and newPassword are required',
          ),
        );
    }
    const currentUser = request.currentUser!;
    const user = await db
      .selectFrom('users')
      .selectAll()
      .where('id', '=', currentUser.userId)
      .executeTakeFirstOrThrow();

    if (!(await verifyPassword(user.password_hash, body.currentPassword))) {
      return reply
        .code(401)
        .type('application/problem+json')
        .send(problem(401, 'auth.invalid_credentials', 'Current password is incorrect'));
    }
    const policy = validatePasswordPolicy(body.newPassword);
    if (!policy.valid) {
      return reply
        .code(400)
        .type('application/problem+json')
        .send(problem(400, 'validation.schema_violation', policy.reason));
    }

    const newHash = await hashPassword(body.newPassword);
    await db
      .updateTable('users')
      .set({ password_hash: newHash, password_changed_at: new Date(), must_change_password: false })
      .where('id', '=', user.id)
      .execute();

    // SEC-08: invalidates every OTHER session — the one making this request stays valid.
    await revokeAllSessionsForUser(db, user.id, 'password_changed', currentUser.sessionId);
    await appendAuditEntry(db, {
      actorUserId: user.id,
      sessionId: currentUser.sessionId,
      sourceAddress: sourceAddressOf(request),
      action: 'auth.password_changed',
      targetType: 'user',
      targetId: user.id,
      beforeState: null,
      afterState: null,
      outcome: 'success',
    });

    return reply.code(204).send();
  });

  app.get('/auth/session', { preHandler: requireSession(deps) }, async (request, reply) => {
    const currentUser = request.currentUser!;
    const user = await db
      .selectFrom('users')
      .selectAll()
      .where('id', '=', currentUser.userId)
      .executeTakeFirstOrThrow();
    return reply.code(200).send({
      user: {
        id: user.id,
        email: user.email,
        displayName: user.display_name,
        role: user.role,
        mfaEnabled: user.mfa_enabled,
        isActive: user.is_active,
        createdAt: user.created_at,
        mustChangePassword: user.must_change_password,
      },
      capabilities: capabilitiesFor(user.role),
    });
  });
}

async function consumeRecoveryCode(
  db: ApiDependencies['db'],
  userId: string,
  code: string,
): Promise<boolean> {
  const hash = sha256Hex(code);
  const row = await db
    .selectFrom('mfa_recovery_codes')
    .select('id')
    .where('user_id', '=', userId)
    .where('code_hash', '=', hash)
    .where('used_at', 'is', null)
    .executeTakeFirst();
  if (!row) return false;
  await db
    .updateTable('mfa_recovery_codes')
    .set({ used_at: new Date() })
    .where('id', '=', row.id)
    .execute();
  return true;
}

/**
 * Cookie issuance + audit trail shared by every path that ends in a live
 * session: normal login, MFA challenge completion, and (setup.ts)
 * /setup/administrator, which has no prior session to log in from. Split
 * out from completeLogin so setup.ts can establish a session and still
 * send its own 201 User body instead of the login endpoint's response shape.
 */
export async function establishSession(
  deps: ApiDependencies,
  request: FastifyRequest,
  reply: import('fastify').FastifyReply,
  userId: string,
  sourceAddress: string,
): Promise<void> {
  const { db } = deps;
  const session = await createSession(db, userId, sourceAddress, request.headers['user-agent'], {
    idleTimeoutMinutes: 30,
    absoluteTimeoutHours: 12,
  });
  reply.setCookie(SESSION_COOKIE, session.rawSessionToken, {
    httpOnly: true,
    secure: true,
    sameSite: 'strict',
    path: '/',
  });
  // SEC-08 double-submit: readable by JS deliberately (not HttpOnly) — the
  // client echoes this back as a header on state-changing requests; the
  // server compares its hash against `sessions.csrf_token_hash`, never a
  // bare cookie-equals-cookie check.
  reply.setCookie(CSRF_COOKIE, session.rawCsrfToken, {
    httpOnly: false,
    secure: true,
    sameSite: 'strict',
    path: '/',
  });

  await db
    .insertInto('auth_events')
    .values({
      actor_identifier: userId,
      event_type: 'login_success',
      source_address: sourceAddress,
      metadata: {} as never,
    })
    .execute();
  await appendAuditEntry(db, {
    actorUserId: userId,
    sessionId: session.sessionId,
    sourceAddress,
    action: 'auth.login_success',
    targetType: 'user',
    targetId: userId,
    beforeState: null,
    afterState: null,
    outcome: 'success',
  });
}

async function completeLogin(
  deps: ApiDependencies,
  request: FastifyRequest,
  reply: import('fastify').FastifyReply,
  userId: string,
  sourceAddress: string,
) {
  await establishSession(deps, request, reply, userId, sourceAddress);
  const user = await deps.db
    .selectFrom('users')
    .selectAll()
    .where('id', '=', userId)
    .executeTakeFirstOrThrow();
  return reply.code(200).send({
    user: {
      id: user.id,
      email: user.email,
      displayName: user.display_name,
      role: user.role,
      mfaEnabled: user.mfa_enabled,
      isActive: user.is_active,
      createdAt: user.created_at,
      mustChangePassword: user.must_change_password,
    },
    capabilities: capabilitiesFor(user.role),
  });
}

export interface CurrentUserContext {
  readonly userId: string;
  readonly sessionId: string;
  readonly csrfTokenHash: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    currentUser?: CurrentUserContext;
  }
}

const MUTATING_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

/**
 * SEC-08/SEC-13: resolves the session cookie into `request.currentUser`
 * and enforces the double-submit CSRF check on every mutating method. This
 * is the ONE place either happens — no route hand-rolls its own auth check.
 */
export function requireSession(deps: ApiDependencies, options: { optional?: boolean } = {}) {
  return async (request: FastifyRequest, reply: import('fastify').FastifyReply) => {
    const rawToken = request.cookies[SESSION_COOKIE];
    const resolved = rawToken
      ? await resolveSession(deps.db, rawToken, {
          idleTimeoutMinutes: 30,
          absoluteTimeoutHours: 12,
        })
      : null;

    if (!resolved) {
      if (options.optional) return;
      return reply
        .code(401)
        .type('application/problem+json')
        .send(problem(401, 'auth.session_required', 'Authentication required'));
    }

    if (MUTATING_METHODS.has(request.method)) {
      const csrfHeader = request.headers['x-csrf-token'];
      const csrfValue = Array.isArray(csrfHeader) ? csrfHeader[0] : csrfHeader;
      if (!csrfValue || !verifyCsrfToken(csrfValue, resolved.csrfTokenHash)) {
        return reply
          .code(403)
          .type('application/problem+json')
          .send(problem(403, 'auth.csrf_token_invalid', 'Missing or invalid CSRF token'));
      }
    }

    request.currentUser = {
      userId: resolved.userId,
      sessionId: resolved.sessionId,
      csrfTokenHash: resolved.csrfTokenHash,
    };
  };
}
