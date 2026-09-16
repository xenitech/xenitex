import type { FastifyInstance } from 'fastify';
import { newId } from '@xenitex/domain';
import type { ApiDependencies } from '../dependencies.js';
import { appendAuditEntry } from '../audit/audit-log.js';
import { requireRole } from '../auth/capabilities.js';
import { problem, requireSession, sourceAddressOf } from './auth.js';
import { buildPage, decodeCursor, parseLimit } from '../lib/pagination.js';
import { getIdempotentResponse, storeIdempotentResponse } from '../lib/idempotency.js';

const MAX_EXCEPTION_DURATION_DAYS = 365;

function toException(row: {
  id: string;
  issue_id: string;
  requested_by: string;
  requested_at: Date | string;
  justification: string;
  approver_user_id: string | null;
  approved_at: Date | string | null;
  expires_at: Date | string;
  status: string;
}) {
  return {
    id: row.id,
    issueId: row.issue_id,
    requestedBy: row.requested_by,
    requestedAt: row.requested_at,
    justification: row.justification,
    approverUserId: row.approver_user_id,
    approvedAt: row.approved_at,
    expiresAt: row.expires_at,
    status: row.status,
  };
}

async function roleOf(db: ApiDependencies['db'], userId: string) {
  const user = await db
    .selectFrom('users')
    .select('role')
    .where('id', '=', userId)
    .executeTakeFirstOrThrow();
  return user.role;
}

export async function registerExceptionRoutes(
  app: FastifyInstance,
  deps: ApiDependencies,
): Promise<void> {
  const { db, redis } = deps;

  app.get('/exceptions', { preHandler: requireSession(deps) }, async (request, reply) => {
    const query = request.query as {
      cursor?: string;
      limit?: string;
      status?: string;
      issueId?: string;
    };
    const limit = parseLimit(query.limit);
    const cursorId = query.cursor ? decodeCursor(query.cursor) : null;

    let q = db
      .selectFrom('exceptions')
      .selectAll()
      .orderBy('id', 'asc')
      .limit(limit + 1);
    if (cursorId) q = q.where('id', '>', cursorId);
    if (query.status) q = q.where('status', '=', query.status as never);
    if (query.issueId) q = q.where('issue_id', '=', query.issueId);
    const rows = await q.execute();

    return reply.code(200).send(buildPage(rows, limit, toException));
  });

  app.post('/exceptions', { preHandler: requireSession(deps) }, async (request, reply) => {
    const currentUser = request.currentUser!;
    if (!requireRole(await roleOf(db, currentUser.userId), 'analyst')) {
      return reply
        .code(403)
        .type('application/problem+json')
        .send(problem(403, 'auth.forbidden', 'Analyst role required'));
    }
    const idempotencyKey = request.headers['idempotency-key'] as string | undefined;
    if (!idempotencyKey) {
      return reply
        .code(400)
        .type('application/problem+json')
        .send(problem(400, 'validation.schema_violation', 'Idempotency-Key header is required'));
    }
    const cached = await getIdempotentResponse(redis, 'createException', idempotencyKey);
    if (cached) return reply.code(cached.status).send(cached.body);

    const body = request.body as { issueId?: string; justification?: string; expiresAt?: string };
    if (!body?.issueId || !body.justification || !body.expiresAt) {
      return reply
        .code(400)
        .type('application/problem+json')
        .send(
          problem(
            400,
            'validation.schema_violation',
            'issueId, justification and expiresAt are required',
          ),
        );
    }
    const issue = await db
      .selectFrom('issues')
      .select('id')
      .where('id', '=', body.issueId)
      .executeTakeFirst();
    if (!issue) {
      return reply
        .code(400)
        .type('application/problem+json')
        .send(
          problem(400, 'validation.schema_violation', 'issueId does not reference a real issue'),
        );
    }
    const requestedAt = new Date();
    const expiresAt = new Date(body.expiresAt);
    const maxExpiry = new Date(requestedAt.getTime() + MAX_EXCEPTION_DURATION_DAYS * 86_400_000);
    if (expiresAt > maxExpiry) {
      return reply
        .code(422)
        .type('application/problem+json')
        .send(
          problem(
            422,
            'exception.expiry_exceeds_maximum',
            `expiresAt cannot be more than ${MAX_EXCEPTION_DURATION_DAYS} days from the request`,
          ),
        );
    }

    const exceptionId = newId();
    await db
      .insertInto('exceptions')
      .values({
        id: exceptionId,
        issue_id: body.issueId,
        requested_by: currentUser.userId,
        requested_at: requestedAt,
        justification: body.justification,
        expires_at: expiresAt,
        status: 'pending',
      })
      .execute();
    await appendAuditEntry(db, {
      actorUserId: currentUser.userId,
      sessionId: currentUser.sessionId,
      sourceAddress: sourceAddressOf(request),
      action: 'exception.requested',
      targetType: 'exception',
      targetId: exceptionId,
      beforeState: null,
      afterState: { issueId: body.issueId, expiresAt: body.expiresAt },
      outcome: 'success',
    });
    const row = await db
      .selectFrom('exceptions')
      .selectAll()
      .where('id', '=', exceptionId)
      .executeTakeFirstOrThrow();
    const responseBody = toException(row);
    await storeIdempotentResponse(redis, 'createException', idempotencyKey, {
      status: 201,
      body: responseBody,
    });
    return reply.code(201).send(responseBody);
  });

  app.get(
    '/exceptions/:exceptionId',
    { preHandler: requireSession(deps) },
    async (request, reply) => {
      const { exceptionId } = request.params as { exceptionId: string };
      const row = await db
        .selectFrom('exceptions')
        .selectAll()
        .where('id', '=', exceptionId)
        .executeTakeFirst();
      if (!row) {
        return reply
          .code(404)
          .type('application/problem+json')
          .send(problem(404, 'resource.not_found', 'Exception not found'));
      }
      return reply.code(200).send(toException(row));
    },
  );

  app.post(
    '/exceptions/:exceptionId/approve',
    { preHandler: requireSession(deps) },
    async (request, reply) => {
      const currentUser = request.currentUser!;
      if (!requireRole(await roleOf(db, currentUser.userId), 'operator')) {
        return reply
          .code(403)
          .type('application/problem+json')
          .send(problem(403, 'auth.forbidden', 'Operator role required'));
      }
      const { exceptionId } = request.params as { exceptionId: string };
      const existing = await db
        .selectFrom('exceptions')
        .selectAll()
        .where('id', '=', exceptionId)
        .executeTakeFirst();
      if (!existing) {
        return reply
          .code(404)
          .type('application/problem+json')
          .send(problem(404, 'resource.not_found', 'Exception not found'));
      }
      // MOD-12: approver must differ from requester -- enforced here, not just by the DB CHECK,
      // so the client gets a real 422 explaining why instead of a raw constraint-violation 500.
      if (existing.requested_by === currentUser.userId) {
        return reply
          .code(422)
          .type('application/problem+json')
          .send(
            problem(
              422,
              'exception.approver_is_requester',
              'The approver must differ from the requester',
            ),
          );
      }
      if (existing.status !== 'pending') {
        return reply
          .code(422)
          .type('application/problem+json')
          .send(problem(422, 'exception.not_pending', 'Only a pending exception can be approved'));
      }

      await db.transaction().execute(async (trx) => {
        await trx
          .updateTable('exceptions')
          .set({
            status: 'approved',
            approver_user_id: currentUser.userId,
            approved_at: new Date(),
          })
          .where('id', '=', exceptionId)
          .execute();
        const issueBefore = await trx
          .selectFrom('issues')
          .select('state')
          .where('id', '=', existing.issue_id)
          .executeTakeFirstOrThrow();
        // MOD-12: an approved exception is how an issue reaches risk_accepted.
        await trx
          .updateTable('issues')
          .set({ state: 'risk_accepted', exception_id: exceptionId, updated_at: new Date() })
          .where('id', '=', existing.issue_id)
          .execute();
        // Kept in sync with issues.ts's transitions endpoint: every state
        // change lands in issue_state_history, not just the ones made
        // through POST /issues/{id}/transitions -- otherwise the issue
        // detail screen's history timeline would silently skip straight
        // from the pre-exception state to whatever happens after the
        // exception is later revoked, with risk_accepted never appearing.
        await trx
          .insertInto('issue_state_history')
          .values({
            id: newId(),
            issue_id: existing.issue_id,
            from_state: issueBefore.state,
            to_state: 'risk_accepted',
            actor_user_id: currentUser.userId,
          })
          .execute();
        await appendAuditEntry(trx, {
          actorUserId: currentUser.userId,
          sessionId: currentUser.sessionId,
          sourceAddress: sourceAddressOf(request),
          action: 'exception.approved',
          targetType: 'exception',
          targetId: exceptionId,
          beforeState: { status: 'pending' },
          afterState: { status: 'approved' },
          outcome: 'success',
        });
      });

      const row = await db
        .selectFrom('exceptions')
        .selectAll()
        .where('id', '=', exceptionId)
        .executeTakeFirstOrThrow();
      return reply.code(200).send(toException(row));
    },
  );

  app.post(
    '/exceptions/:exceptionId/reject',
    { preHandler: requireSession(deps) },
    async (request, reply) => {
      const currentUser = request.currentUser!;
      if (!requireRole(await roleOf(db, currentUser.userId), 'operator')) {
        return reply
          .code(403)
          .type('application/problem+json')
          .send(problem(403, 'auth.forbidden', 'Operator role required'));
      }
      const { exceptionId } = request.params as { exceptionId: string };
      const existing = await db
        .selectFrom('exceptions')
        .selectAll()
        .where('id', '=', exceptionId)
        .executeTakeFirst();
      if (!existing) {
        return reply
          .code(404)
          .type('application/problem+json')
          .send(problem(404, 'resource.not_found', 'Exception not found'));
      }
      const body = request.body as { reason?: string };
      if (!body?.reason) {
        return reply
          .code(400)
          .type('application/problem+json')
          .send(problem(400, 'validation.schema_violation', 'reason is required'));
      }
      if (existing.status !== 'pending') {
        return reply
          .code(422)
          .type('application/problem+json')
          .send(problem(422, 'exception.not_pending', 'Only a pending exception can be rejected'));
      }
      await db
        .updateTable('exceptions')
        .set({ status: 'rejected', approver_user_id: currentUser.userId })
        .where('id', '=', exceptionId)
        .execute();
      await appendAuditEntry(db, {
        actorUserId: currentUser.userId,
        sessionId: currentUser.sessionId,
        sourceAddress: sourceAddressOf(request),
        action: 'exception.rejected',
        targetType: 'exception',
        targetId: exceptionId,
        beforeState: { status: 'pending' },
        afterState: { status: 'rejected', reason: body.reason },
        outcome: 'success',
      });
      const row = await db
        .selectFrom('exceptions')
        .selectAll()
        .where('id', '=', exceptionId)
        .executeTakeFirstOrThrow();
      return reply.code(200).send(toException(row));
    },
  );

  app.post(
    '/exceptions/:exceptionId/revoke',
    { preHandler: requireSession(deps) },
    async (request, reply) => {
      const currentUser = request.currentUser!;
      if (!requireRole(await roleOf(db, currentUser.userId), 'operator')) {
        return reply
          .code(403)
          .type('application/problem+json')
          .send(problem(403, 'auth.forbidden', 'Operator role required'));
      }
      const { exceptionId } = request.params as { exceptionId: string };
      const existing = await db
        .selectFrom('exceptions')
        .selectAll()
        .where('id', '=', exceptionId)
        .executeTakeFirst();
      if (!existing) {
        return reply
          .code(404)
          .type('application/problem+json')
          .send(problem(404, 'resource.not_found', 'Exception not found'));
      }
      const body = request.body as { reason?: string };
      if (!body?.reason) {
        return reply
          .code(400)
          .type('application/problem+json')
          .send(problem(400, 'validation.schema_violation', 'reason is required'));
      }
      if (existing.status !== 'approved') {
        return reply
          .code(422)
          .type('application/problem+json')
          .send(
            problem(422, 'exception.not_approved', 'Only an approved exception can be revoked'),
          );
      }

      await db.transaction().execute(async (trx) => {
        await trx
          .updateTable('exceptions')
          .set({
            status: 'revoked',
            revoked_by: currentUser.userId,
            revoked_at: new Date(),
            revoked_reason: body.reason,
          })
          .where('id', '=', exceptionId)
          .execute();
        // Revoking early reopens the issue -- MOD-10's `reopened` state, and
        // the exception link is cleared since it's no longer the active
        // reason this issue isn't being worked.
        await trx
          .updateTable('issues')
          .set({ state: 'reopened', exception_id: null, updated_at: new Date() })
          .where('id', '=', existing.issue_id)
          .where('exception_id', '=', exceptionId)
          .execute();
        await trx
          .insertInto('issue_state_history')
          .values({
            id: newId(),
            issue_id: existing.issue_id,
            from_state: 'risk_accepted',
            to_state: 'reopened',
            actor_user_id: currentUser.userId,
            justification: body.reason,
          })
          .execute();
        await appendAuditEntry(trx, {
          actorUserId: currentUser.userId,
          sessionId: currentUser.sessionId,
          sourceAddress: sourceAddressOf(request),
          action: 'exception.revoked',
          targetType: 'exception',
          targetId: exceptionId,
          beforeState: { status: 'approved' },
          afterState: { status: 'revoked', reason: body.reason },
          outcome: 'success',
        });
      });

      const row = await db
        .selectFrom('exceptions')
        .selectAll()
        .where('id', '=', exceptionId)
        .executeTakeFirstOrThrow();
      return reply.code(200).send(toException(row));
    },
  );
}
