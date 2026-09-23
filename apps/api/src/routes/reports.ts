import type { FastifyInstance } from 'fastify';
import { newId } from '@xenitex/domain';
import type { ApiDependencies } from '../dependencies.js';
import { appendAuditEntry } from '../audit/audit-log.js';
import { requireRole } from '../auth/capabilities.js';
import { problem, requireSession, sourceAddressOf } from './auth.js';
import { buildPage, decodeCursor, parseLimit } from '../lib/pagination.js';
import { getIdempotentResponse, storeIdempotentResponse } from '../lib/idempotency.js';

const REPORT_TEMPLATES = ['executive_summary', 'technical_detail', 'delta'] as const;
const REPORT_FORMATS = ['html', 'csv', 'json'] as const;
type ReportFormat = (typeof REPORT_FORMATS)[number];

const CONTENT_TYPE_BY_FORMAT: Record<ReportFormat, string> = {
  html: 'text/html; charset=utf-8',
  csv: 'text/csv; charset=utf-8',
  json: 'application/json',
};

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

  /**
   * 4.8/P2-19. The panel's Reports screen has always had a Generate button
   * wired to this operation and the contract has always documented it —
   * it simply was not implemented, so the button 404'd. Generation itself
   * is a worker job (apps/worker/src/pipeline/process-report.ts): a report
   * over PERF-01 volumes is not something to do inside an HTTP handler,
   * and ADR 0006 requires long-running operations to return a job resource
   * and be polled rather than blocking a request.
   */
  app.post('/reports', { preHandler: requireSession(deps) }, async (request, reply) => {
    const currentUser = request.currentUser!;
    // A report is an export of findings; an analyst may produce one, a
    // viewer may only read ones that already exist (SEC-13).
    if (!requireRole(currentUser.role, 'analyst')) {
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
    const cached = await getIdempotentResponse(deps.redis, 'createReport', idempotencyKey);
    if (cached) return reply.code(cached.status).send(cached.body);

    const body = request.body as {
      template?: string;
      scopeFilter?: Record<string, unknown>;
      dateRangeStart?: string;
      dateRangeEnd?: string;
      formats?: string[];
    };

    if (!body?.template || !REPORT_TEMPLATES.includes(body.template as never)) {
      return reply
        .code(400)
        .type('application/problem+json')
        .send(
          problem(
            400,
            'validation.schema_violation',
            `template must be one of: ${REPORT_TEMPLATES.join(', ')}`,
          ),
        );
    }
    const formats = body.formats ?? [];
    if (formats.length === 0 || formats.some((f) => !REPORT_FORMATS.includes(f as never))) {
      return reply
        .code(400)
        .type('application/problem+json')
        .send(
          problem(
            400,
            'validation.schema_violation',
            `formats must be a non-empty subset of: ${REPORT_FORMATS.join(', ')}`,
          ),
        );
    }
    // The delta template is defined as the difference between two dates,
    // so it cannot be generated without them — rejected here rather than
    // producing an empty or silently full-history "delta".
    if (body.template === 'delta' && (!body.dateRangeStart || !body.dateRangeEnd)) {
      return reply
        .code(400)
        .type('application/problem+json')
        .send(
          problem(
            400,
            'validation.schema_violation',
            'dateRangeStart and dateRangeEnd are required for the delta template',
          ),
        );
    }
    if (body.dateRangeStart && body.dateRangeEnd && body.dateRangeStart > body.dateRangeEnd) {
      return reply
        .code(400)
        .type('application/problem+json')
        .send(
          problem(
            400,
            'validation.schema_violation',
            'dateRangeStart must not be after dateRangeEnd',
          ),
        );
    }

    const reportId = newId();
    await db
      .insertInto('reports')
      .values({
        id: reportId,
        template: body.template as never,
        scope_filter: JSON.stringify(body.scopeFilter ?? {}) as never,
        date_range_start: body.dateRangeStart ?? null,
        date_range_end: body.dateRangeEnd ?? null,
        status: 'pending',
        formats: formats as never,
        generated_by: currentUser.userId,
      })
      .execute();

    await appendAuditEntry(db, {
      actorUserId: currentUser.userId,
      sessionId: currentUser.sessionId,
      sourceAddress: sourceAddressOf(request),
      action: 'report.requested',
      targetType: 'report',
      targetId: reportId,
      beforeState: null,
      afterState: { template: body.template, formats },
      outcome: 'success',
    });

    const row = await db
      .selectFrom('reports')
      .selectAll()
      .where('id', '=', reportId)
      .executeTakeFirstOrThrow();
    const responseBody = toReport(row);
    await storeIdempotentResponse(deps.redis, 'createReport', idempotencyKey, {
      status: 202,
      body: responseBody,
    });
    return reply.code(202).header('Location', `/v1/reports/${reportId}`).send(responseBody);
  });

  app.get(
    '/reports/:reportId/download',
    { preHandler: requireSession(deps) },
    async (request, reply) => {
      const { reportId } = request.params as { reportId: string };
      const { format } = request.query as { format?: string };

      if (!format || !REPORT_FORMATS.includes(format as never)) {
        return reply
          .code(400)
          .type('application/problem+json')
          .send(
            problem(
              400,
              'validation.schema_violation',
              `format is required and must be one of: ${REPORT_FORMATS.join(', ')}`,
            ),
          );
      }

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
      if (row.status !== 'completed' || !row.blob_store_key) {
        return reply
          .code(409)
          .type('application/problem+json')
          .send(
            problem(
              409,
              'report.not_ready',
              'Report generation is not complete',
              `Report is currently '${row.status}'. Poll GET /v1/reports/${reportId} until it reports 'completed'.`,
            ),
          );
      }
      if (!row.formats.includes(format)) {
        return reply
          .code(404)
          .type('application/problem+json')
          .send(
            problem(
              404,
              'resource.not_found',
              `This report was not generated in '${format}' format`,
            ),
          );
      }

      let bytes: Buffer;
      try {
        bytes = await deps.blobStore.get(`${row.blob_store_key}.${format}`);
      } catch {
        return reply
          .code(410)
          .type('application/problem+json')
          .send(
            problem(410, 'report.artifact_unavailable', 'This report artifact is no longer stored'),
          );
      }

      // `attachment` + nosniff even for the HTML template: a report embeds
      // scanner-derived strings (SEC-17), and although the generator
      // escapes them, serving it inline would put any escaping mistake on
      // the appliance's own origin alongside the operator's session.
      return reply
        .code(200)
        .header('Content-Type', CONTENT_TYPE_BY_FORMAT[format as ReportFormat])
        .header('X-Content-Type-Options', 'nosniff')
        .header('Content-Disposition', `attachment; filename="${row.template}-${row.id}.${format}"`)
        .send(bytes);
    },
  );
}
