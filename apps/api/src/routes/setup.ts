import type { FastifyInstance } from 'fastify';
import { newId } from '@xenitex/domain';
import type { ApiDependencies } from '../dependencies.js';
import { appendAuditEntry } from '../audit/audit-log.js';
import { hashPassword, validatePasswordPolicy } from '../auth/passwords.js';
import { requireRole } from '../auth/capabilities.js';
import { establishSession, problem, requireSession, sourceAddressOf } from './auth.js';

interface SetupStatus {
  administratorCreated: boolean;
  organizationConfigured: boolean;
  tlsConfigured: boolean;
  initialScopeDeclared: boolean;
  safetyAcknowledged: boolean;
  setupCompleted: boolean;
}

async function computeSetupStatus(db: ApiDependencies['db']): Promise<SetupStatus> {
  const [admin, org, scope] = await Promise.all([
    db.selectFrom('users').select('id').where('role', '=', 'administrator').executeTakeFirst(),
    db
      .selectFrom('organization_settings')
      .select(['tls_mode', 'safety_defaults_acknowledged_at', 'setup_completed_at'])
      .where('id', '=', 1)
      .executeTakeFirst(),
    db
      .selectFrom('authorized_scopes')
      .select('id')
      .where('superseded_by_id', 'is', null)
      .executeTakeFirst(),
  ]);

  return {
    administratorCreated: admin !== undefined,
    organizationConfigured: org !== undefined,
    tlsConfigured: org?.tls_mode != null,
    initialScopeDeclared: scope !== undefined,
    safetyAcknowledged: org?.safety_defaults_acknowledged_at != null,
    setupCompleted: org?.setup_completed_at != null,
  };
}

export async function registerSetupRoutes(
  app: FastifyInstance,
  deps: ApiDependencies,
): Promise<void> {
  const { db } = deps;

  app.get('/setup/status', async (_request, reply) => {
    return reply.code(200).send(await computeSetupStatus(db));
  });

  // Public by contract (no session can exist before this account does), but
  // must self-guard: once any administrator exists, this stays a live,
  // unauthenticated route forever, so it must never be usable to mint a
  // second one.
  app.post('/setup/administrator', async (request, reply) => {
    const existing = await db
      .selectFrom('users')
      .select('id')
      .where('role', '=', 'administrator')
      .executeTakeFirst();
    if (existing) {
      return reply
        .code(409)
        .type('application/problem+json')
        .send(problem(409, 'setup.already_initialized', 'An administrator already exists'));
    }

    const body = request.body as { email?: string; displayName?: string; password?: string };
    if (!body?.email || !body.displayName || !body.password) {
      return reply
        .code(400)
        .type('application/problem+json')
        .send(
          problem(
            400,
            'validation.schema_violation',
            'email, displayName and password are required',
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

    const passwordHash = await hashPassword(body.password);
    const userId = newId();
    const sourceAddress = sourceAddressOf(request);
    const email = body.email;
    const displayName = body.displayName;
    // Same transaction: a user row that exists but whose creation audit
    // entry failed to write (real incident -- a missing sequence grant
    // broke appendAuditEntry the first time this ran under xenitex_app
    // instead of the Postgres superuser) left an unrecoverable state, since
    // this route 409s forever once any administrator row exists but no
    // session had been issued yet for it.
    await db.transaction().execute(async (trx) => {
      await trx
        .insertInto('users')
        .values({
          id: userId,
          email,
          display_name: displayName,
          role: 'administrator',
          password_hash: passwordHash,
          // The wizard already collected a password the administrator chose
          // themselves -- unlike an administrator-provisioned account (P1-07),
          // there is no separate owner who still needs to set their own.
          must_change_password: false,
        })
        .execute();
      await appendAuditEntry(trx, {
        actorUserId: userId,
        sessionId: null,
        sourceAddress,
        action: 'setup.administrator_created',
        targetType: 'user',
        targetId: userId,
        beforeState: null,
        afterState: { email, role: 'administrator' },
        outcome: 'success',
      });
    });

    // The rest of the wizard (organization/tls/scope/safety) is
    // session-gated by contract default -- establish one now, since this is
    // the only setup step that could not have had a session already.
    await establishSession(deps, request, reply, userId, sourceAddress);

    const user = await db
      .selectFrom('users')
      .selectAll()
      .where('id', '=', userId)
      .executeTakeFirstOrThrow();
    return reply.code(201).send({
      id: user.id,
      email: user.email,
      displayName: user.display_name,
      role: user.role,
      mfaEnabled: user.mfa_enabled,
      isActive: user.is_active,
      createdAt: user.created_at,
      mustChangePassword: user.must_change_password,
    });
  });

  app.post('/setup/organization', { preHandler: requireSession(deps) }, async (request, reply) => {
    if (!requireRole(await roleOf(db, request.currentUser!.userId), 'administrator')) {
      return reply
        .code(403)
        .type('application/problem+json')
        .send(problem(403, 'auth.forbidden', 'Administrator role required'));
    }
    const body = request.body as { organizationName?: string; timezone?: string };
    if (!body?.organizationName || !body.timezone) {
      return reply
        .code(400)
        .type('application/problem+json')
        .send(
          problem(400, 'validation.schema_violation', 'organizationName and timezone are required'),
        );
    }
    await db
      .insertInto('organization_settings')
      .values({ id: 1, organization_name: body.organizationName, timezone: body.timezone })
      .onConflict((oc) =>
        oc.column('id').doUpdateSet({
          organization_name: body.organizationName,
          timezone: body.timezone,
          updated_at: new Date(),
        }),
      )
      .execute();
    return reply.code(204).send();
  });

  app.post('/setup/tls', { preHandler: requireSession(deps) }, async (request, reply) => {
    if (!requireRole(await roleOf(db, request.currentUser!.userId), 'administrator')) {
      return reply
        .code(403)
        .type('application/problem+json')
        .send(problem(403, 'auth.forbidden', 'Administrator role required'));
    }
    const body = request.body as { tlsMode?: 'self_signed' | 'customer_certificate' };
    if (body?.tlsMode !== 'self_signed' && body?.tlsMode !== 'customer_certificate') {
      return reply
        .code(400)
        .type('application/problem+json')
        .send(problem(400, 'validation.schema_violation', 'tlsMode must be a recognised value'));
    }
    const result = await db
      .updateTable('organization_settings')
      .set({ tls_mode: body.tlsMode, updated_at: new Date() })
      .where('id', '=', 1)
      .executeTakeFirst();
    if (result.numUpdatedRows === 0n) {
      return reply
        .code(409)
        .type('application/problem+json')
        .send(
          problem(409, 'setup.organization_not_configured', 'Configure the organisation first'),
        );
    }
    return reply.code(204).send();
  });

  app.post('/setup/initial-scope', { preHandler: requireSession(deps) }, async (request, reply) => {
    const currentUser = request.currentUser!;
    if (!requireRole(await roleOf(db, currentUser.userId), 'administrator')) {
      return reply
        .code(403)
        .type('application/problem+json')
        .send(problem(403, 'auth.forbidden', 'Administrator role required'));
    }
    const body = request.body as {
      name?: string;
      cidrRanges?: string[];
      hostnames?: string[];
      attestationType?: string;
      attestationDetails?: string;
    };
    const cidrRanges = body?.cidrRanges ?? [];
    const hostnames = body?.hostnames ?? [];
    if (!body?.name || !body.attestationType || !body.attestationDetails) {
      return reply
        .code(400)
        .type('application/problem+json')
        .send(
          problem(
            400,
            'validation.schema_violation',
            'name, attestationType and attestationDetails are required',
          ),
        );
    }
    if (cidrRanges.length === 0 && hostnames.length === 0) {
      return reply
        .code(400)
        .type('application/problem+json')
        .send(
          problem(
            400,
            'validation.schema_violation',
            'At least one CIDR range or hostname is required',
          ),
        );
    }

    const scopeId = newId();
    try {
      await db
        .insertInto('authorized_scopes')
        .values({
          id: scopeId,
          name: body.name,
          cidr_ranges: cidrRanges,
          hostnames,
          attestation_type: body.attestationType as never,
          attestation_details: body.attestationDetails,
          accepted_by_user_id: currentUser.userId,
        })
        .execute();
    } catch {
      return reply
        .code(400)
        .type('application/problem+json')
        .send(
          problem(400, 'validation.schema_violation', 'Invalid CIDR range or attestation type'),
        );
    }
    await appendAuditEntry(db, {
      actorUserId: currentUser.userId,
      sessionId: currentUser.sessionId,
      sourceAddress: sourceAddressOf(request),
      action: 'setup.initial_scope_declared',
      targetType: 'authorized_scope',
      targetId: scopeId,
      beforeState: null,
      afterState: { name: body.name, cidrRanges, hostnames },
      outcome: 'success',
    });

    const scope = await db
      .selectFrom('authorized_scopes')
      .selectAll()
      .where('id', '=', scopeId)
      .executeTakeFirstOrThrow();
    return reply.code(201).send({
      id: scope.id,
      name: scope.name,
      cidrRanges: scope.cidr_ranges,
      hostnames: scope.hostnames,
      attestationType: scope.attestation_type,
      attestationDetails: scope.attestation_details,
      acceptedByUserId: scope.accepted_by_user_id,
      acceptedAt: scope.accepted_at,
      supersededById: scope.superseded_by_id,
    });
  });

  app.post(
    '/setup/safety-acknowledgement',
    { preHandler: requireSession(deps) },
    async (request, reply) => {
      const currentUser = request.currentUser!;
      if (!requireRole(await roleOf(db, currentUser.userId), 'administrator')) {
        return reply
          .code(403)
          .type('application/problem+json')
          .send(problem(403, 'auth.forbidden', 'Administrator role required'));
      }
      const result = await db
        .updateTable('organization_settings')
        .set({
          safety_defaults_acknowledged_by: currentUser.userId,
          safety_defaults_acknowledged_at: new Date(),
          updated_at: new Date(),
        })
        .where('id', '=', 1)
        .executeTakeFirst();
      if (result.numUpdatedRows === 0n) {
        return reply
          .code(409)
          .type('application/problem+json')
          .send(
            problem(409, 'setup.organization_not_configured', 'Configure the organisation first'),
          );
      }
      await appendAuditEntry(db, {
        actorUserId: currentUser.userId,
        sessionId: currentUser.sessionId,
        sourceAddress: sourceAddressOf(request),
        action: 'setup.safety_defaults_acknowledged',
        targetType: 'organization_settings',
        targetId: '1',
        beforeState: null,
        afterState: null,
        outcome: 'success',
      });
      return reply.code(204).send();
    },
  );

  app.post('/setup/complete', { preHandler: requireSession(deps) }, async (request, reply) => {
    const currentUser = request.currentUser!;
    if (!requireRole(await roleOf(db, currentUser.userId), 'administrator')) {
      return reply
        .code(403)
        .type('application/problem+json')
        .send(problem(403, 'auth.forbidden', 'Administrator role required'));
    }
    const status = await computeSetupStatus(db);
    const { setupCompleted, ...prerequisites } = status;
    if (Object.values(prerequisites).some((done) => !done)) {
      return reply
        .code(409)
        .type('application/problem+json')
        .send(problem(409, 'setup.incomplete', 'Complete every setup step first'));
    }
    if (!setupCompleted) {
      await db
        .updateTable('organization_settings')
        .set({ setup_completed_at: new Date(), updated_at: new Date() })
        .where('id', '=', 1)
        .execute();
      await appendAuditEntry(db, {
        actorUserId: currentUser.userId,
        sessionId: currentUser.sessionId,
        sourceAddress: sourceAddressOf(request),
        action: 'setup.completed',
        targetType: 'organization_settings',
        targetId: '1',
        beforeState: null,
        afterState: null,
        outcome: 'success',
      });
    }
    return reply.code(204).send();
  });
}

async function roleOf(db: ApiDependencies['db'], userId: string) {
  const user = await db
    .selectFrom('users')
    .select('role')
    .where('id', '=', userId)
    .executeTakeFirstOrThrow();
  return user.role;
}
