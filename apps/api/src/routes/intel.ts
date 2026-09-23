import type { FastifyInstance } from 'fastify';
import { newId } from '@xenitex/domain';
import type { ApiDependencies } from '../dependencies.js';
import { appendAuditEntry } from '../audit/audit-log.js';
import { requireRole } from '../auth/capabilities.js';
import { problem, requireSession, sourceAddressOf } from './auth.js';
import { buildPage, decodeCursor, parseLimit } from '../lib/pagination.js';
import { getIdempotentResponse, storeIdempotentResponse } from '../lib/idempotency.js';
import { etagFor } from '../lib/etag.js';

async function requireAdministrator(db: ApiDependencies['db'], userId: string): Promise<boolean> {
  const user = await db
    .selectFrom('users')
    .select('role')
    .where('id', '=', userId)
    .executeTakeFirstOrThrow();
  return requireRole(user.role, 'administrator');
}

interface RecordCounts {
  readonly fetched?: number;
  readonly added?: number;
  readonly modified?: number;
  readonly discarded?: number;
  readonly requestedOptions?: { modifiedSinceDays: number };
}

function toIntelImport(row: {
  id: string;
  source_name: string;
  source_version: string;
  status: string;
  record_counts: unknown;
  failure_reason: string | null;
  imported_at: Date | string;
  imported_by: string | null;
  superseded_by_id: string | null;
}) {
  const counts = (row.record_counts as RecordCounts | null) ?? {};
  return {
    id: row.id,
    sourceName: row.source_name,
    sourceVersion: row.source_version,
    status: row.status,
    fetched: counts.fetched ?? null,
    added: counts.added ?? null,
    modified: counts.modified ?? null,
    discarded: counts.discarded ?? null,
    failureReason: row.failure_reason,
    importedAt: row.imported_at,
    importedBy: row.imported_by,
    supersededById: row.superseded_by_id,
  };
}

export async function registerIntelRoutes(
  app: FastifyInstance,
  deps: ApiDependencies,
): Promise<void> {
  const { db, redis } = deps;

  app.get('/intel/status', { preHandler: requireSession(deps) }, async (_request, reply) => {
    const activeImport = await db
      .selectFrom('vulnerability_data_imports')
      .selectAll()
      .where('source_name', '=', 'nvd')
      .where('status', '=', 'applied')
      .where('superseded_by_id', 'is', null)
      .orderBy('imported_at', 'desc')
      .executeTakeFirst();
    const lastAttempt = await db
      .selectFrom('vulnerability_data_imports')
      .selectAll()
      .where('source_name', '=', 'nvd')
      .orderBy('imported_at', 'desc')
      .executeTakeFirst();
    const totals = await db
      .selectFrom('vulnerabilities')
      .select((eb) => [
        eb.fn.countAll().as('total'),
        eb.fn.count('id').filterWhere('known_exploited', '=', true).as('knownExploited'),
      ])
      .executeTakeFirstOrThrow();
    const settings = await db
      .selectFrom('intel_settings')
      .selectAll()
      .where('id', '=', 1)
      .executeTakeFirstOrThrow();

    return reply.code(200).send({
      onlineUpdatesDisabled: settings.online_updates_disabled,
      activeCorpusImport: activeImport ? toIntelImport(activeImport) : null,
      lastSyncAttempt: lastAttempt ? toIntelImport(lastAttempt) : null,
      totalVulnerabilities: Number(totals.total),
      knownExploitedCount: Number(totals.knownExploited),
    });
  });

  app.get('/intel/imports', { preHandler: requireSession(deps) }, async (request, reply) => {
    const query = request.query as { cursor?: string; limit?: string };
    const limit = parseLimit(query.limit);
    const cursorId = query.cursor ? decodeCursor(query.cursor) : null;
    let q = db
      .selectFrom('vulnerability_data_imports')
      .selectAll()
      .orderBy('id', 'asc')
      .limit(limit + 1);
    if (cursorId) q = q.where('id', '>', cursorId);
    const rows = await q.execute();
    return reply.code(200).send(buildPage(rows, limit, toIntelImport));
  });

  app.post('/intel/sync', { preHandler: requireSession(deps) }, async (request, reply) => {
    const currentUser = request.currentUser!;
    if (!(await requireAdministrator(db, currentUser.userId))) {
      return reply
        .code(403)
        .type('application/problem+json')
        .send(problem(403, 'auth.forbidden', 'Administrator role required'));
    }
    const idempotencyKey = request.headers['idempotency-key'] as string | undefined;
    if (!idempotencyKey) {
      return reply
        .code(400)
        .type('application/problem+json')
        .send(problem(400, 'validation.schema_violation', 'Idempotency-Key header is required'));
    }
    const cached = await getIdempotentResponse(redis, 'createIntelSync', idempotencyKey);
    if (cached) return reply.code(cached.status).send(cached.body);

    const settings = await db
      .selectFrom('intel_settings')
      .selectAll()
      .where('id', '=', 1)
      .executeTakeFirstOrThrow();
    if (settings.online_updates_disabled) {
      return reply
        .code(409)
        .type('application/problem+json')
        .send(
          problem(
            409,
            'intel.online_updates_disabled',
            'Online intelligence updates are permanently disabled for this deployment (FEED-23)',
          ),
        );
    }
    // A sync already in flight is not a conflict worth erroring on -- report
    // the existing one rather than queue a second concurrent fetch against
    // the same rate-limited upstream.
    const inFlight = await db
      .selectFrom('vulnerability_data_imports')
      .selectAll()
      .where('source_name', '=', 'nvd')
      .where('status', '=', 'validating')
      .executeTakeFirst();
    if (inFlight) {
      return reply.code(202).send(toIntelImport(inFlight));
    }

    const body = request.body as { modifiedSinceDays?: number } | undefined;
    const modifiedSinceDays = body?.modifiedSinceDays ?? 7;
    if (!Number.isInteger(modifiedSinceDays) || modifiedSinceDays < 1 || modifiedSinceDays > 120) {
      return reply
        .code(400)
        .type('application/problem+json')
        .send(
          problem(
            400,
            'validation.schema_violation',
            'modifiedSinceDays must be an integer between 1 and 120',
          ),
        );
    }

    const importId = newId();
    await db
      .insertInto('vulnerability_data_imports')
      .values({
        id: importId,
        source_name: 'nvd',
        source_version: `modified-window:${modifiedSinceDays}d`,
        status: 'validating',
        record_counts: JSON.stringify({ requestedOptions: { modifiedSinceDays } }) as never,
        imported_by: currentUser.userId,
      })
      .execute();
    // FEED-22: the window's "open" half. apps/worker's processIntelImport
    // records the matching "closed" half (success or failure) once the
    // fetch actually completes -- the two share targetId so they read as
    // one bracketed event in the audit log.
    await appendAuditEntry(db, {
      actorUserId: currentUser.userId,
      sessionId: currentUser.sessionId,
      sourceAddress: sourceAddressOf(request),
      action: 'intel.egress_window_opened',
      targetType: 'vulnerability_data_import',
      targetId: importId,
      beforeState: null,
      afterState: { sourceName: 'nvd', modifiedSinceDays },
      outcome: 'success',
    });

    const row = await db
      .selectFrom('vulnerability_data_imports')
      .selectAll()
      .where('id', '=', importId)
      .executeTakeFirstOrThrow();
    const responseBody = toIntelImport(row);
    await storeIdempotentResponse(redis, 'createIntelSync', idempotencyKey, {
      status: 202,
      body: responseBody,
    });
    return reply.code(202).header('Location', `/v1/intel/imports/${importId}`).send(responseBody);
  });

  app.get('/intel/settings', { preHandler: requireSession(deps) }, async (_request, reply) => {
    const row = await db
      .selectFrom('intel_settings')
      .selectAll()
      .where('id', '=', 1)
      .executeTakeFirstOrThrow();
    const body = { onlineUpdatesDisabled: row.online_updates_disabled };
    return reply.code(200).header('ETag', etagFor(body)).send(body);
  });

  app.patch('/intel/settings', { preHandler: requireSession(deps) }, async (request, reply) => {
    const currentUser = request.currentUser!;
    if (!(await requireAdministrator(db, currentUser.userId))) {
      return reply
        .code(403)
        .type('application/problem+json')
        .send(problem(403, 'auth.forbidden', 'Administrator role required'));
    }
    const existing = await db
      .selectFrom('intel_settings')
      .selectAll()
      .where('id', '=', 1)
      .executeTakeFirstOrThrow();
    const currentBody = { onlineUpdatesDisabled: existing.online_updates_disabled };
    const ifMatch = request.headers['if-match'] as string | undefined;
    if (!ifMatch || ifMatch !== etagFor(currentBody)) {
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
    const body = request.body as { onlineUpdatesDisabled?: boolean };
    if (typeof body.onlineUpdatesDisabled !== 'boolean') {
      return reply
        .code(400)
        .type('application/problem+json')
        .send(
          problem(
            400,
            'validation.schema_violation',
            'onlineUpdatesDisabled (boolean) is required',
          ),
        );
    }
    await db
      .updateTable('intel_settings')
      .set({
        online_updates_disabled: body.onlineUpdatesDisabled,
        updated_at: new Date(),
        updated_by: currentUser.userId,
      })
      .where('id', '=', 1)
      .execute();
    await appendAuditEntry(db, {
      actorUserId: currentUser.userId,
      sessionId: currentUser.sessionId,
      sourceAddress: sourceAddressOf(request),
      action: body.onlineUpdatesDisabled
        ? 'intel.online_updates_disabled'
        : 'intel.online_updates_enabled',
      targetType: 'intel_settings',
      targetId: '1',
      beforeState: currentBody,
      afterState: { onlineUpdatesDisabled: body.onlineUpdatesDisabled },
      outcome: 'success',
    });
    const newBody = { onlineUpdatesDisabled: body.onlineUpdatesDisabled };
    return reply.code(200).header('ETag', etagFor(newBody)).send(newBody);
  });
}
