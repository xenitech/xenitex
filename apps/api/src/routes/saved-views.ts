import type { FastifyInstance } from 'fastify';
import { newId } from '@xenitex/domain';
import type { ApiDependencies } from '../dependencies.js';
import { appendAuditEntry } from '../audit/audit-log.js';
import { problem, requireSession, sourceAddressOf } from './auth.js';
import { getIdempotentResponse, storeIdempotentResponse } from '../lib/idempotency.js';
import { etagFor } from '../lib/etag.js';

function toSavedView(row: {
  id: string;
  name: string;
  query: string;
  is_shared: boolean;
  created_by: string;
}) {
  return {
    id: row.id,
    name: row.name,
    query: row.query,
    isShared: row.is_shared,
    createdBy: row.created_by,
  };
}

export async function registerSavedViewRoutes(
  app: FastifyInstance,
  deps: ApiDependencies,
): Promise<void> {
  const { db, redis } = deps;

  app.get('/saved-views', { preHandler: requireSession(deps) }, async (request, reply) => {
    const currentUser = request.currentUser!;
    // A saved view is visible if it's shared, or the current user's own private one.
    const rows = await db
      .selectFrom('saved_views')
      .selectAll()
      .where((eb) => eb.or([eb('is_shared', '=', true), eb('created_by', '=', currentUser.userId)]))
      .orderBy('created_at', 'asc')
      .execute();
    return reply.code(200).send(rows.map(toSavedView));
  });

  app.post('/saved-views', { preHandler: requireSession(deps) }, async (request, reply) => {
    const currentUser = request.currentUser!;
    const idempotencyKey = request.headers['idempotency-key'] as string | undefined;
    if (!idempotencyKey) {
      return reply
        .code(400)
        .type('application/problem+json')
        .send(problem(400, 'validation.schema_violation', 'Idempotency-Key header is required'));
    }
    const cached = await getIdempotentResponse(redis, 'createSavedView', idempotencyKey);
    if (cached) return reply.code(cached.status).send(cached.body);

    const body = request.body as { name?: string; query?: string; isShared?: boolean };
    if (!body?.name || !body.query) {
      return reply
        .code(400)
        .type('application/problem+json')
        .send(problem(400, 'validation.schema_violation', 'name and query are required'));
    }
    const viewId = newId();
    await db
      .insertInto('saved_views')
      .values({
        id: viewId,
        name: body.name,
        query: body.query,
        is_shared: body.isShared ?? false,
        created_by: currentUser.userId,
      })
      .execute();
    await appendAuditEntry(db, {
      actorUserId: currentUser.userId,
      sessionId: currentUser.sessionId,
      sourceAddress: sourceAddressOf(request),
      action: 'saved_view.created',
      targetType: 'saved_view',
      targetId: viewId,
      beforeState: null,
      afterState: { name: body.name, isShared: body.isShared ?? false },
      outcome: 'success',
    });
    const row = await db
      .selectFrom('saved_views')
      .selectAll()
      .where('id', '=', viewId)
      .executeTakeFirstOrThrow();
    const responseBody = toSavedView(row);
    await storeIdempotentResponse(redis, 'createSavedView', idempotencyKey, {
      status: 201,
      body: responseBody,
    });
    return reply.code(201).send(responseBody);
  });

  app.get('/saved-views/:viewId', { preHandler: requireSession(deps) }, async (request, reply) => {
    const { viewId } = request.params as { viewId: string };
    const row = await db
      .selectFrom('saved_views')
      .selectAll()
      .where('id', '=', viewId)
      .executeTakeFirst();
    if (!row) {
      return reply
        .code(404)
        .type('application/problem+json')
        .send(problem(404, 'resource.not_found', 'Saved view not found'));
    }
    return reply
      .code(200)
      .header('ETag', etagFor(toSavedView(row)))
      .send(toSavedView(row));
  });

  app.patch(
    '/saved-views/:viewId',
    { preHandler: requireSession(deps) },
    async (request, reply) => {
      const currentUser = request.currentUser!;
      const { viewId } = request.params as { viewId: string };
      const existing = await db
        .selectFrom('saved_views')
        .selectAll()
        .where('id', '=', viewId)
        .executeTakeFirst();
      if (!existing) {
        return reply
          .code(404)
          .type('application/problem+json')
          .send(problem(404, 'resource.not_found', 'Saved view not found'));
      }
      if (existing.created_by !== currentUser.userId) {
        return reply
          .code(403)
          .type('application/problem+json')
          .send(problem(403, 'auth.forbidden', 'Only the creator can update this saved view'));
      }
      const ifMatch = request.headers['if-match'] as string | undefined;
      if (!ifMatch || ifMatch !== etagFor(toSavedView(existing))) {
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
      const body = request.body as { name?: string; query?: string; isShared?: boolean };
      await db
        .updateTable('saved_views')
        .set({
          ...(body.name ? { name: body.name } : {}),
          ...(body.query ? { query: body.query } : {}),
          ...(body.isShared !== undefined ? { is_shared: body.isShared } : {}),
          updated_at: new Date(),
        })
        .where('id', '=', viewId)
        .execute();
      await appendAuditEntry(db, {
        actorUserId: currentUser.userId,
        sessionId: currentUser.sessionId,
        sourceAddress: sourceAddressOf(request),
        action: 'saved_view.updated',
        targetType: 'saved_view',
        targetId: viewId,
        beforeState: null,
        afterState: null,
        outcome: 'success',
      });
      const updated = await db
        .selectFrom('saved_views')
        .selectAll()
        .where('id', '=', viewId)
        .executeTakeFirstOrThrow();
      return reply
        .code(200)
        .header('ETag', etagFor(toSavedView(updated)))
        .send(toSavedView(updated));
    },
  );

  app.delete(
    '/saved-views/:viewId',
    { preHandler: requireSession(deps) },
    async (request, reply) => {
      const currentUser = request.currentUser!;
      const { viewId } = request.params as { viewId: string };
      const existing = await db
        .selectFrom('saved_views')
        .select(['id', 'created_by'])
        .where('id', '=', viewId)
        .executeTakeFirst();
      if (!existing) {
        return reply
          .code(404)
          .type('application/problem+json')
          .send(problem(404, 'resource.not_found', 'Saved view not found'));
      }
      if (existing.created_by !== currentUser.userId) {
        return reply
          .code(403)
          .type('application/problem+json')
          .send(problem(403, 'auth.forbidden', 'Only the creator can delete this saved view'));
      }
      await db.deleteFrom('saved_views').where('id', '=', viewId).execute();
      await appendAuditEntry(db, {
        actorUserId: currentUser.userId,
        sessionId: currentUser.sessionId,
        sourceAddress: sourceAddressOf(request),
        action: 'saved_view.deleted',
        targetType: 'saved_view',
        targetId: viewId,
        beforeState: null,
        afterState: null,
        outcome: 'success',
      });
      return reply.code(204).send();
    },
  );
}
