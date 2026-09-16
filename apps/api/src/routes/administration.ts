import type { FastifyInstance } from 'fastify';
import { createHash } from 'node:crypto';
import { newId } from '@xenitex/domain';
import type { ApiDependencies } from '../dependencies.js';
import { appendAuditEntry } from '../audit/audit-log.js';
import { requireRole } from '../auth/capabilities.js';
import { hashPassword, validatePasswordPolicy } from '../auth/passwords.js';
import { revokeAllSessionsForUser } from '../auth/sessions.js';
import { problem, requireSession, sourceAddressOf } from './auth.js';
import { buildPage, decodeCursor, parseLimit } from '../lib/pagination.js';

function etagFor(value: unknown): string {
  return `"${createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 32)}"`;
}

function toUser(user: {
  id: string;
  email: string;
  display_name: string;
  role: string;
  mfa_enabled: boolean;
  is_active: boolean;
  created_at: Date | string;
  must_change_password: boolean;
}) {
  return {
    id: user.id,
    email: user.email,
    displayName: user.display_name,
    role: user.role,
    mfaEnabled: user.mfa_enabled,
    isActive: user.is_active,
    createdAt: user.created_at,
    mustChangePassword: user.must_change_password,
  };
}

function toOrganizationSettings(settings: {
  organization_name: string;
  timezone: string;
  tls_mode: string | null;
  setup_completed_at: Date | string | null;
}) {
  return {
    organizationName: settings.organization_name,
    timezone: settings.timezone,
    tlsMode: settings.tls_mode,
    setupCompletedAt: settings.setup_completed_at,
  };
}

function toFeatureFlag(flag: {
  key: string;
  description: string;
  is_enabled: boolean;
  updated_at: Date | string;
}) {
  return {
    key: flag.key,
    description: flag.description,
    isEnabled: flag.is_enabled,
    updatedAt: flag.updated_at,
  };
}

async function requireAdministrator(db: ApiDependencies['db'], userId: string): Promise<boolean> {
  const user = await db
    .selectFrom('users')
    .select('role')
    .where('id', '=', userId)
    .executeTakeFirstOrThrow();
  return requireRole(user.role, 'administrator');
}

export async function registerAdministrationRoutes(
  app: FastifyInstance,
  deps: ApiDependencies,
): Promise<void> {
  const { db } = deps;

  // -------------------------------------------------------------- Users
  app.get('/users', { preHandler: requireSession(deps) }, async (request, reply) => {
    const currentUser = request.currentUser!;
    if (!(await requireAdministrator(db, currentUser.userId))) {
      return reply
        .code(403)
        .type('application/problem+json')
        .send(problem(403, 'auth.forbidden', 'Administrator role required'));
    }
    const query = request.query as { cursor?: string; limit?: string };
    const limit = parseLimit(query.limit);
    const cursorId = query.cursor ? decodeCursor(query.cursor) : null;

    let q = db
      .selectFrom('users')
      .selectAll()
      .orderBy('id', 'asc')
      .limit(limit + 1);
    if (cursorId) q = q.where('id', '>', cursorId);
    const rows = await q.execute();

    return reply.code(200).send(buildPage(rows, limit, toUser));
  });

  app.post('/users', { preHandler: requireSession(deps) }, async (request, reply) => {
    const currentUser = request.currentUser!;
    if (!(await requireAdministrator(db, currentUser.userId))) {
      return reply
        .code(403)
        .type('application/problem+json')
        .send(problem(403, 'auth.forbidden', 'Administrator role required'));
    }
    const body = request.body as {
      email?: string;
      displayName?: string;
      role?: string;
      password?: string;
    };
    if (!body?.email || !body.displayName || !body.role || !body.password) {
      return reply
        .code(400)
        .type('application/problem+json')
        .send(
          problem(
            400,
            'validation.schema_violation',
            'email, displayName, role and password are required',
          ),
        );
    }
    const policy = validatePasswordPolicy(body.password);
    if (!policy.valid) {
      return reply
        .code(400)
        .type('application/problem+json')
        .send(problem(400, 'validation.schema_violation', policy.reason));
    }

    const existing = await db
      .selectFrom('users')
      .select('id')
      .where('email', '=', body.email)
      .executeTakeFirst();
    if (existing) {
      return reply
        .code(409)
        .type('application/problem+json')
        .send(problem(409, 'resource.conflict', 'A user with this email already exists'));
    }

    const userId = newId();
    // P1-07: administrator-provisioned accounts start with mustChangePassword
    // true -- the sign-in flow forces a real password before anything else,
    // rather than the administrator's chosen one-time value staying live.
    await db
      .insertInto('users')
      .values({
        id: userId,
        email: body.email,
        display_name: body.displayName,
        role: body.role as never,
        password_hash: await hashPassword(body.password),
        must_change_password: true,
      })
      .execute();
    await appendAuditEntry(db, {
      actorUserId: currentUser.userId,
      sessionId: currentUser.sessionId,
      sourceAddress: sourceAddressOf(request),
      action: 'user.created',
      targetType: 'user',
      targetId: userId,
      beforeState: null,
      afterState: { email: body.email, role: body.role },
      outcome: 'success',
    });

    const user = await db
      .selectFrom('users')
      .selectAll()
      .where('id', '=', userId)
      .executeTakeFirstOrThrow();
    return reply.code(201).send(toUser(user));
  });

  app.get('/users/:userId', { preHandler: requireSession(deps) }, async (request, reply) => {
    const currentUser = request.currentUser!;
    if (!(await requireAdministrator(db, currentUser.userId))) {
      return reply
        .code(403)
        .type('application/problem+json')
        .send(problem(403, 'auth.forbidden', 'Administrator role required'));
    }
    const { userId } = request.params as { userId: string };
    const user = await db
      .selectFrom('users')
      .selectAll()
      .where('id', '=', userId)
      .executeTakeFirst();
    if (!user) {
      return reply
        .code(404)
        .type('application/problem+json')
        .send(problem(404, 'resource.not_found', 'User not found'));
    }
    return reply
      .code(200)
      .header('ETag', etagFor(toUser(user)))
      .send(toUser(user));
  });

  app.patch('/users/:userId', { preHandler: requireSession(deps) }, async (request, reply) => {
    const currentUser = request.currentUser!;
    if (!(await requireAdministrator(db, currentUser.userId))) {
      return reply
        .code(403)
        .type('application/problem+json')
        .send(problem(403, 'auth.forbidden', 'Administrator role required'));
    }
    const { userId } = request.params as { userId: string };
    const existing = await db
      .selectFrom('users')
      .selectAll()
      .where('id', '=', userId)
      .executeTakeFirst();
    if (!existing) {
      return reply
        .code(404)
        .type('application/problem+json')
        .send(problem(404, 'resource.not_found', 'User not found'));
    }
    const ifMatch = request.headers['if-match'] as string | undefined;
    if (!ifMatch || ifMatch !== etagFor(toUser(existing))) {
      return reply
        .code(409)
        .type('application/problem+json')
        .send(
          problem(
            409,
            'concurrency.stale_resource',
            'If-Match does not match the current resource',
          ),
        );
    }
    const body = request.body as { role?: string; displayName?: string };
    await db
      .updateTable('users')
      .set({
        ...(body.role ? { role: body.role as never } : {}),
        ...(body.displayName ? { display_name: body.displayName } : {}),
        updated_at: new Date(),
      })
      .where('id', '=', userId)
      .execute();
    await appendAuditEntry(db, {
      actorUserId: currentUser.userId,
      sessionId: currentUser.sessionId,
      sourceAddress: sourceAddressOf(request),
      action: 'user.updated',
      targetType: 'user',
      targetId: userId,
      beforeState: { role: existing.role, displayName: existing.display_name },
      afterState: {
        role: body.role ?? existing.role,
        displayName: body.displayName ?? existing.display_name,
      },
      outcome: 'success',
    });
    const updated = await db
      .selectFrom('users')
      .selectAll()
      .where('id', '=', userId)
      .executeTakeFirstOrThrow();
    return reply
      .code(200)
      .header('ETag', etagFor(toUser(updated)))
      .send(toUser(updated));
  });

  app.post(
    '/users/:userId/deactivate',
    { preHandler: requireSession(deps) },
    async (request, reply) => {
      const currentUser = request.currentUser!;
      if (!(await requireAdministrator(db, currentUser.userId))) {
        return reply
          .code(403)
          .type('application/problem+json')
          .send(problem(403, 'auth.forbidden', 'Administrator role required'));
      }
      const { userId } = request.params as { userId: string };
      const existing = await db
        .selectFrom('users')
        .select('id')
        .where('id', '=', userId)
        .executeTakeFirst();
      if (!existing) {
        return reply
          .code(404)
          .type('application/problem+json')
          .send(problem(404, 'resource.not_found', 'User not found'));
      }
      await db
        .updateTable('users')
        .set({ is_active: false, updated_at: new Date() })
        .where('id', '=', userId)
        .execute();
      await revokeAllSessionsForUser(db, userId, 'account_deactivated');
      await appendAuditEntry(db, {
        actorUserId: currentUser.userId,
        sessionId: currentUser.sessionId,
        sourceAddress: sourceAddressOf(request),
        action: 'user.deactivated',
        targetType: 'user',
        targetId: userId,
        beforeState: { isActive: true },
        afterState: { isActive: false },
        outcome: 'success',
      });
      return reply.code(204).send();
    },
  );

  // ------------------------------------------------- OrganizationSettings
  app.get(
    '/organization-settings',
    { preHandler: requireSession(deps) },
    async (_request, reply) => {
      const settings = await db
        .selectFrom('organization_settings')
        .selectAll()
        .where('id', '=', 1)
        .executeTakeFirst();
      if (!settings) {
        return reply
          .code(404)
          .type('application/problem+json')
          .send(problem(404, 'resource.not_found', 'Organisation has not completed setup yet'));
      }
      return reply
        .code(200)
        .header('ETag', etagFor(toOrganizationSettings(settings)))
        .send(toOrganizationSettings(settings));
    },
  );

  app.patch(
    '/organization-settings',
    { preHandler: requireSession(deps) },
    async (request, reply) => {
      const currentUser = request.currentUser!;
      if (!(await requireAdministrator(db, currentUser.userId))) {
        return reply
          .code(403)
          .type('application/problem+json')
          .send(problem(403, 'auth.forbidden', 'Administrator role required'));
      }
      const existing = await db
        .selectFrom('organization_settings')
        .selectAll()
        .where('id', '=', 1)
        .executeTakeFirst();
      if (!existing) {
        return reply
          .code(404)
          .type('application/problem+json')
          .send(problem(404, 'resource.not_found', 'Organisation has not completed setup yet'));
      }
      const ifMatch = request.headers['if-match'] as string | undefined;
      if (!ifMatch || ifMatch !== etagFor(toOrganizationSettings(existing))) {
        return reply
          .code(409)
          .type('application/problem+json')
          .send(
            problem(
              409,
              'concurrency.stale_resource',
              'If-Match does not match the current resource',
            ),
          );
      }
      const body = request.body as {
        organizationName?: string;
        timezone?: string;
        tlsMode?: string;
      };
      await db
        .updateTable('organization_settings')
        .set({
          ...(body.organizationName ? { organization_name: body.organizationName } : {}),
          ...(body.timezone ? { timezone: body.timezone } : {}),
          ...(body.tlsMode ? { tls_mode: body.tlsMode } : {}),
          updated_at: new Date(),
        })
        .where('id', '=', 1)
        .execute();
      await appendAuditEntry(db, {
        actorUserId: currentUser.userId,
        sessionId: currentUser.sessionId,
        sourceAddress: sourceAddressOf(request),
        action: 'organization_settings.updated',
        targetType: 'organization_settings',
        targetId: '1',
        beforeState: toOrganizationSettings(existing),
        afterState: null,
        outcome: 'success',
      });
      const updated = await db
        .selectFrom('organization_settings')
        .selectAll()
        .where('id', '=', 1)
        .executeTakeFirstOrThrow();
      return reply
        .code(200)
        .header('ETag', etagFor(toOrganizationSettings(updated)))
        .send(toOrganizationSettings(updated));
    },
  );

  // ------------------------------------------------------------ FeatureFlags
  app.get('/feature-flags', { preHandler: requireSession(deps) }, async (_request, reply) => {
    const flags = await db.selectFrom('feature_flags').selectAll().orderBy('key', 'asc').execute();
    return reply.code(200).send(flags.map(toFeatureFlag));
  });

  app.patch('/feature-flags/:key', { preHandler: requireSession(deps) }, async (request, reply) => {
    const currentUser = request.currentUser!;
    if (!(await requireAdministrator(db, currentUser.userId))) {
      return reply
        .code(403)
        .type('application/problem+json')
        .send(problem(403, 'auth.forbidden', 'Administrator role required'));
    }
    const { key } = request.params as { key: string };
    const existing = await db
      .selectFrom('feature_flags')
      .selectAll()
      .where('key', '=', key)
      .executeTakeFirst();
    if (!existing) {
      return reply
        .code(404)
        .type('application/problem+json')
        .send(problem(404, 'resource.not_found', 'Feature flag not found'));
    }
    const body = request.body as { isEnabled?: boolean };
    if (typeof body?.isEnabled !== 'boolean') {
      return reply
        .code(400)
        .type('application/problem+json')
        .send(problem(400, 'validation.schema_violation', 'isEnabled is required'));
    }
    // EXT-09/PRIN-01: hard-off by construction, not merely by default -- no
    // remediation-execution code exists in this codebase for the flag to
    // gate, so enabling it can never do anything but lie to the UI.
    if (key === 'remediation_executor_enabled' && body.isEnabled) {
      return reply
        .code(422)
        .type('application/problem+json')
        .send(
          problem(
            422,
            'feature_flag.no_implementation',
            'This flag has no implementation behind it and cannot be enabled',
          ),
        );
    }
    await db
      .updateTable('feature_flags')
      .set({ is_enabled: body.isEnabled, updated_by: currentUser.userId, updated_at: new Date() })
      .where('key', '=', key)
      .execute();
    await appendAuditEntry(db, {
      actorUserId: currentUser.userId,
      sessionId: currentUser.sessionId,
      sourceAddress: sourceAddressOf(request),
      action: 'feature_flag.updated',
      targetType: 'feature_flag',
      targetId: key,
      beforeState: { isEnabled: existing.is_enabled },
      afterState: { isEnabled: body.isEnabled },
      outcome: 'success',
    });
    const updated = await db
      .selectFrom('feature_flags')
      .selectAll()
      .where('key', '=', key)
      .executeTakeFirstOrThrow();
    return reply.code(200).send(toFeatureFlag(updated));
  });
}
