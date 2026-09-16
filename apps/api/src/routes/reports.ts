import type { FastifyInstance } from 'fastify';
import type { ApiDependencies } from '../dependencies.js';
import { problem, requireSession } from './auth.js';
import { buildPage, decodeCursor, parseLimit } from '../lib/pagination.js';

function toReport(row: {
  id: string;
  template: string;
  scope_filter: unknown;
  date_range_start: Date | string | null;
  date_range_end: Date | string | null;
  status: string;
  data_versions: unknown;
  formats: string[];
  blob_store_key: string | null;
  generated_by: string;
  generated_at: Date | string;
  completed_at: Date | string | null;
}) {
  return {
    id: row.id,
    template: row.template,
    scopeFilter: row.scope_filter,
    dateRangeStart: row.date_range_start,
    dateRangeEnd: row.date_range_end,
    status: row.status,
    dataVersions: row.data_versions,
    formats: row.formats,
    blobStoreKey: row.blob_store_key,
    generatedBy: row.generated_by,
    generatedAt: row.generated_at,
    completedAt: row.completed_at,
  };
}

export async function registerReportRoutes(
  app: FastifyInstance,
  deps: ApiDependencies,
): Promise<void> {
  const { db } = deps;

  app.get('/reports', { preHandler: requireSession(deps) }, async (request, reply) => {
    const query = request.query as { cursor?: string; limit?: string; status?: string };
    const limit = parseLimit(query.limit);
    const cursorId = query.cursor ? decodeCursor(query.cursor) : null;

    let q = db
      .selectFrom('reports')
      .selectAll()
      .orderBy('id', 'asc')
      .limit(limit + 1);
    if (cursorId) q = q.where('id', '>', cursorId);
    if (query.status) q = q.where('status', '=', query.status as never);
    const rows = await q.execute();

    return reply.code(200).send(buildPage(rows, limit, toReport));
  });

  app.get('/reports/:reportId', { preHandler: requireSession(deps) }, async (request, reply) => {
    const { reportId } = request.params as { reportId: string };
    const row = await db
      .selectFrom('reports')
      .selectAll()
      .where('id', '=', reportId)
      .executeTakeFirst();
    if (!row) {
      return reply
        .code(404)
        .type('application/problem+json')
        .send(problem(404, 'resource.not_found', 'Report not found'));
    }
    return reply.code(200).send(toReport(row));
  });
}
