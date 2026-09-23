import type { FastifyInstance } from 'fastify';
import { newId } from '@xenitex/domain';
import type { ApiDependencies } from '../dependencies.js';
import { appendAuditEntry } from '../audit/audit-log.js';
import { requireRole } from '../auth/capabilities.js';
import { problem, requireSession, sourceAddressOf } from './auth.js';
import { buildPage, decodeCursor, parseLimit } from '../lib/pagination.js';
import { getIdempotentResponse, storeIdempotentResponse } from '../lib/idempotency.js';
import { etagFor } from '../lib/etag.js';

// Matches apps/api/src/routes/scheduling.ts's etagFor exactly (ADR 0006) —
// duplicated rather than shared, same call as apps/api/src/lib/cidr.ts's
// duplication in apps/worker: one small self-contained helper, not worth a
// new shared module for.
function toAuthorizedScope(scope: {
  id: string;
  name: string;
  cidr_ranges: string[];
  hostnames: string[];
  attestation_type: string;
  attestation_details: string;
  accepted_by_user_id: string;
  accepted_at: Date | string;
  superseded_by_id: string | null;
}) {
  return {
    id: scope.id,
    name: scope.name,
    cidrRanges: scope.cidr_ranges,
    hostnames: scope.hostnames,
    attestationType: scope.attestation_type,
    attestationDetails: scope.attestation_details,
    acceptedByUserId: scope.accepted_by_user_id,
    acceptedAt: scope.accepted_at,
    supersededById: scope.superseded_by_id,
  };
}

function toExclusionRule(rule: {
  id: string;
  scope_id: string | null;
  rule_type: string;
  value: string;
  reason: string;
  created_by: string;
  created_at: Date | string;
  is_active: boolean;
}) {
  return {
    id: rule.id,
    scopeId: rule.scope_id,
    ruleType: rule.rule_type,
    value: rule.value,
    reason: rule.reason,
    createdBy: rule.created_by,
    createdAt: rule.created_at,
    isActive: rule.is_active,
  };
}

export async function registerScopeRoutes(
  app: FastifyInstance,
  deps: ApiDependencies,
): Promise<void> {
  const { db, redis } = deps;

  app.get('/authorized-scopes', { preHandler: requireSession(deps) }, async (request, reply) => {
    const query = request.query as { cursor?: string; limit?: string };
    const limit = parseLimit(query.limit);
    const cursorId = query.cursor ? decodeCursor(query.cursor) : null;

    let q = db
      .selectFrom('authorized_scopes')
      .selectAll()
      .orderBy('id', 'asc')
      .limit(limit + 1);
    if (cursorId) q = q.where('id', '>', cursorId);
    const rows = await q.execute();

    return reply.code(200).send(buildPage(rows, limit, toAuthorizedScope));
  });

  app.post('/authorized-scopes', { preHandler: requireSession(deps) }, async (request, reply) => {
    const currentUser = request.currentUser!;
    if (!requireRole(await roleOf(db, currentUser.userId), 'operator')) {
      return reply
        .code(403)
        .type('application/problem+json')
        .send(problem(403, 'auth.forbidden', 'Operator role required'));
    }
    const idempotencyKey = request.headers['idempotency-key'] as string | undefined;
    if (!idempotencyKey) {
      return reply
        .code(400)
        .type('application/problem+json')
        .send(problem(400, 'validation.schema_violation', 'Idempotency-Key header is required'));
    }
    const cached = await getIdempotentResponse(redis, 'createAuthorizedScope', idempotencyKey);
    if (cached) return reply.code(cached.status).send(cached.body);

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
      action: 'scope.authorized_scope_created',
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
    const responseBody = toAuthorizedScope(scope);
    await storeIdempotentResponse(redis, 'createAuthorizedScope', idempotencyKey, {
      status: 201,
      body: responseBody,
    });
    return reply.code(201).send(responseBody);
  });

  app.get(
    '/authorized-scopes/:scopeId',
    { preHandler: requireSession(deps) },
    async (request, reply) => {
      const { scopeId } = request.params as { scopeId: string };
      const scope = await db
        .selectFrom('authorized_scopes')
        .selectAll()
        .where('id', '=', scopeId)
        .executeTakeFirst();
      if (!scope) {
        return reply
          .code(404)
          .type('application/problem+json')
          .send(problem(404, 'resource.not_found', 'Authorized scope not found'));
      }
      return reply.code(200).send(toAuthorizedScope(scope));
    },
  );

  // SAFE-01: "Immutable once accepted; changes create a new record." A scope
  // is a legal attestation of authority, not a config value — there is no
  // PATCH/DELETE that mutates or removes one. "Editing" a scope means
  // declaring a brand-new one (with its own fresh attestation, UI-80) that
  // supersedes the old record; the old record's own fields never change,
  // only its supersededById link, and only once.
  app.post(
    '/authorized-scopes/:scopeId/supersede',
    { preHandler: requireSession(deps) },
    async (request, reply) => {
      const currentUser = request.currentUser!;
      if (!requireRole(await roleOf(db, currentUser.userId), 'operator')) {
        return reply
          .code(403)
          .type('application/problem+json')
          .send(problem(403, 'auth.forbidden', 'Operator role required'));
      }
      const { scopeId } = request.params as { scopeId: string };
      const idempotencyKey = request.headers['idempotency-key'] as string | undefined;
      if (!idempotencyKey) {
        return reply
          .code(400)
          .type('application/problem+json')
          .send(problem(400, 'validation.schema_violation', 'Idempotency-Key header is required'));
      }
      const cached = await getIdempotentResponse(redis, 'supersedeAuthorizedScope', idempotencyKey);
      if (cached) return reply.code(cached.status).send(cached.body);

      const existing = await db
        .selectFrom('authorized_scopes')
        .selectAll()
        .where('id', '=', scopeId)
        .executeTakeFirst();
      if (!existing) {
        return reply
          .code(404)
          .type('application/problem+json')
          .send(problem(404, 'resource.not_found', 'Authorized scope not found'));
      }
      if (existing.superseded_by_id) {
        return reply
          .code(409)
          .type('application/problem+json')
          .send(
            problem(
              409,
              'scope.already_superseded',
              'This scope has already been superseded by a later declaration',
            ),
          );
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

      const newScopeId = newId();
      try {
        await db.transaction().execute(async (trx) => {
          await trx
            .insertInto('authorized_scopes')
            .values({
              id: newScopeId,
              name: body.name!,
              cidr_ranges: cidrRanges,
              hostnames,
              attestation_type: body.attestationType as never,
              attestation_details: body.attestationDetails!,
              accepted_by_user_id: currentUser.userId,
            })
            .execute();
          await trx
            .updateTable('authorized_scopes')
            .set({ superseded_by_id: newScopeId })
            .where('id', '=', scopeId)
            .where('superseded_by_id', 'is', null) // re-check under the transaction: last-writer-wins race guard
            .execute();
        });
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
        action: 'scope.authorized_scope_superseded',
        targetType: 'authorized_scope',
        targetId: scopeId,
        beforeState: { supersededById: null },
        afterState: { supersededById: newScopeId },
        outcome: 'success',
      });
      await appendAuditEntry(db, {
        actorUserId: currentUser.userId,
        sessionId: currentUser.sessionId,
        sourceAddress: sourceAddressOf(request),
        action: 'scope.authorized_scope_created',
        targetType: 'authorized_scope',
        targetId: newScopeId,
        beforeState: null,
        afterState: { name: body.name, cidrRanges, hostnames, supersedes: scopeId },
        outcome: 'success',
      });

      const created = await db
        .selectFrom('authorized_scopes')
        .selectAll()
        .where('id', '=', newScopeId)
        .executeTakeFirstOrThrow();
      const responseBody = toAuthorizedScope(created);
      await storeIdempotentResponse(redis, 'supersedeAuthorizedScope', idempotencyKey, {
        status: 201,
        body: responseBody,
      });
      return reply
        .code(201)
        .header('Location', `/v1/authorized-scopes/${newScopeId}`)
        .send(responseBody);
    },
  );

  app.get('/exclusion-rules', { preHandler: requireSession(deps) }, async (request, reply) => {
    const query = request.query as { cursor?: string; limit?: string; scopeId?: string };
    const limit = parseLimit(query.limit);
    const cursorId = query.cursor ? decodeCursor(query.cursor) : null;

    let q = db
      .selectFrom('exclusion_rules')
      .selectAll()
      .orderBy('id', 'asc')
      .limit(limit + 1);
    if (cursorId) q = q.where('id', '>', cursorId);
    if (query.scopeId) q = q.where('scope_id', '=', query.scopeId);
    const rows = await q.execute();

    return reply.code(200).send(buildPage(rows, limit, toExclusionRule));
  });

  app.post('/exclusion-rules', { preHandler: requireSession(deps) }, async (request, reply) => {
    const currentUser = request.currentUser!;
    if (!requireRole(await roleOf(db, currentUser.userId), 'operator')) {
      return reply
        .code(403)
        .type('application/problem+json')
        .send(problem(403, 'auth.forbidden', 'Operator role required'));
    }
    const idempotencyKey = request.headers['idempotency-key'] as string | undefined;
    if (!idempotencyKey) {
      return reply
        .code(400)
        .type('application/problem+json')
        .send(problem(400, 'validation.schema_violation', 'Idempotency-Key header is required'));
    }
    const cached = await getIdempotentResponse(redis, 'createExclusionRule', idempotencyKey);
    if (cached) return reply.code(cached.status).send(cached.body);

    const body = request.body as {
      scopeId?: string | null;
      ruleType?: string;
      value?: string;
      reason?: string;
    };
    if (!body?.ruleType || !body.value || !body.reason) {
      return reply
        .code(400)
        .type('application/problem+json')
        .send(
          problem(400, 'validation.schema_violation', 'ruleType, value and reason are required'),
        );
    }

    const ruleId = newId();
    await db
      .insertInto('exclusion_rules')
      .values({
        id: ruleId,
        scope_id: body.scopeId ?? null,
        rule_type: body.ruleType as never,
        value: body.value,
        reason: body.reason,
        created_by: currentUser.userId,
      })
      .execute();
    await appendAuditEntry(db, {
      actorUserId: currentUser.userId,
      sessionId: currentUser.sessionId,
      sourceAddress: sourceAddressOf(request),
      action: 'scope.exclusion_rule_created',
      targetType: 'exclusion_rule',
      targetId: ruleId,
      beforeState: null,
      afterState: { ruleType: body.ruleType, value: body.value },
      outcome: 'success',
    });

    const rule = await db
      .selectFrom('exclusion_rules')
      .selectAll()
      .where('id', '=', ruleId)
      .executeTakeFirstOrThrow();
    const responseBody = toExclusionRule(rule);
    await storeIdempotentResponse(redis, 'createExclusionRule', idempotencyKey, {
      status: 201,
      body: responseBody,
    });
    return reply.code(201).send(responseBody);
  });

  app.get(
    '/exclusion-rules/:ruleId',
    { preHandler: requireSession(deps) },
    async (request, reply) => {
      const { ruleId } = request.params as { ruleId: string };
      const rule = await db
        .selectFrom('exclusion_rules')
        .selectAll()
        .where('id', '=', ruleId)
        .executeTakeFirst();
      if (!rule) {
        return reply
          .code(404)
          .type('application/problem+json')
          .send(problem(404, 'resource.not_found', 'Exclusion rule not found'));
      }
      return reply
        .code(200)
        .header('ETag', etagFor(toExclusionRule(rule)))
        .send(toExclusionRule(rule));
    },
  );

  // SAFE-02: value/ruleType/reason are never edited in place — changing what
  // an exclusion actually targets without a new record would lose the audit
  // trail of what was excluded, when, and why. The only mutation this route
  // permits is the isActive toggle the OpenAPI contract already declared
  // ("Deactivate a rule") — this was declared in the frozen v1 spec and
  // served by the mock server, but never implemented against the real
  // database until now.
  app.patch(
    '/exclusion-rules/:ruleId',
    { preHandler: requireSession(deps) },
    async (request, reply) => {
      const currentUser = request.currentUser!;
      if (!requireRole(await roleOf(db, currentUser.userId), 'operator')) {
        return reply
          .code(403)
          .type('application/problem+json')
          .send(problem(403, 'auth.forbidden', 'Operator role required'));
      }
      const { ruleId } = request.params as { ruleId: string };
      const existing = await db
        .selectFrom('exclusion_rules')
        .selectAll()
        .where('id', '=', ruleId)
        .executeTakeFirst();
      if (!existing) {
        return reply
          .code(404)
          .type('application/problem+json')
          .send(problem(404, 'resource.not_found', 'Exclusion rule not found'));
      }
      const ifMatch = request.headers['if-match'] as string | undefined;
      if (!ifMatch || ifMatch !== etagFor(toExclusionRule(existing))) {
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
      const body = request.body as { isActive?: boolean };
      if (typeof body.isActive !== 'boolean') {
        return reply
          .code(400)
          .type('application/problem+json')
          .send(problem(400, 'validation.schema_violation', 'isActive (boolean) is required'));
      }
      await db
        .updateTable('exclusion_rules')
        .set({ is_active: body.isActive })
        .where('id', '=', ruleId)
        .execute();
      await appendAuditEntry(db, {
        actorUserId: currentUser.userId,
        sessionId: currentUser.sessionId,
        sourceAddress: sourceAddressOf(request),
        action: body.isActive
          ? 'scope.exclusion_rule_reactivated'
          : 'scope.exclusion_rule_deactivated',
        targetType: 'exclusion_rule',
        targetId: ruleId,
        beforeState: { isActive: existing.is_active },
        afterState: { isActive: body.isActive },
        outcome: 'success',
      });
      const updated = await db
        .selectFrom('exclusion_rules')
        .selectAll()
        .where('id', '=', ruleId)
        .executeTakeFirstOrThrow();
      return reply
        .code(200)
        .header('ETag', etagFor(toExclusionRule(updated)))
        .send(toExclusionRule(updated));
    },
  );
}

async function roleOf(db: ApiDependencies['db'], userId: string) {
  const user = await db
    .selectFrom('users')
    .select('role')
    .where('id', '=', userId)
    .executeTakeFirstOrThrow();
  return user.role;
}
