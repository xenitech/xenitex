import type { components } from '@xenitex/contracts';
import type { AppState } from '../app-state.js';
import { Problems } from '../problem.js';
import { computeETag } from '../store.js';
import { paginate } from '../pagination.js';
import {
  checkIfMatch,
  makeDelete,
  makeGet,
  makeListFlat,
  nextId,
  paramOf,
  queryOf,
  sendProblem,
  withIdempotency,
  type MockHandler,
} from './generic.js';

export function buildReportsNotificationsHandlers(state: AppState): Record<string, MockHandler> {
  return {
    listReports: (c, _req, reply) => {
      const query = queryOf(c);
      const items = [...state.reports.all()].sort((a, b) =>
        a.generatedAt < b.generatedAt ? 1 : -1,
      );
      const limit = query.limit ? Number.parseInt(query.limit, 10) : undefined;
      const page = paginate(items, {
        cursor: query.cursor,
        limit,
        sortKey: (r) => r.generatedAt,
        id: (r) => r.id,
      });
      reply.code(200).send({ items: page.items, nextCursor: page.nextCursor });
    },
    createReport: (c, req, reply) => {
      const body = c.request.requestBody as components['schemas']['ReportCreate'];
      withIdempotency('createReport', req, reply, () => {
        const id = nextId('report');
        const report: components['schemas']['Report'] = {
          id,
          template: body.template,
          scopeFilter: body.scopeFilter,
          dateRangeStart: body.dateRangeStart ?? null,
          dateRangeEnd: body.dateRangeEnd ?? null,
          status: 'pending',
          dataVersions: null,
          formats: body.formats,
          blobStoreKey: null,
          generatedBy: 'user-analyst-1',
          generatedAt: new Date().toISOString(),
          completedAt: null,
        };
        state.reports.set(report);
        setTimeout(() => {
          state.reports.patch(id, {
            status: 'completed',
            dataVersions: {
              vulnerabilityDataImportId: 'import-nvd-1',
              riskScoringPolicyVersion: 1,
            },
            blobStoreKey: `reports/${id}.html`,
            completedAt: new Date().toISOString(),
          });
        }, 500);
        return { status: 202, body: report, headers: { location: `/v1/reports/${id}` } };
      });
    },
    getReport: makeGet(state.reports, 'reportId', 'report', false),
    downloadReport: (c, _req, reply) => {
      const id = paramOf(c, 'reportId');
      const report = state.reports.get(id);
      if (!report) return sendProblem(reply, Problems.notFound('report'));
      if (report.status !== 'completed') {
        return sendProblem(
          reply,
          Problems.conflict('report.not_ready', 'Report generation is not yet complete.'),
        );
      }
      const format = (c.request.query as Record<string, string>).format ?? 'html';
      if (format === 'json') return reply.code(200).send({ report });
      if (format === 'csv')
        return reply
          .code(200)
          .header('content-type', 'text/csv')
          .send('id,template,status\n' + `${report.id},${report.template},${report.status}\n`);
      reply
        .code(200)
        .header('content-type', 'text/html')
        .send(
          `<html><body><h1>Mock ${report.template} report</h1><p>Generated ${report.generatedAt}</p></body></html>`,
        );
    },

    listNotificationChannels: makeListFlat(() => state.notificationChannels.all()),
    createNotificationChannel: (c, req, reply) => {
      const body = c.request.requestBody as components['schemas']['NotificationChannelCreate'];
      withIdempotency('createNotificationChannel', req, reply, () => {
        const channel: components['schemas']['NotificationChannel'] = {
          id: nextId('channel'),
          ...body,
        };
        state.notificationChannels.set(channel);
        return { status: 201, body: channel };
      });
    },
    updateNotificationChannel: (c, req, reply) => {
      const id = paramOf(c, 'channelId');
      const existing = state.notificationChannels.get(id);
      if (!existing) return sendProblem(reply, Problems.notFound('notification_channel'));
      if (!checkIfMatch(reply, req, existing)) return;
      const updated = state.notificationChannels.patch(id, c.request.requestBody as object)!;
      reply.header('etag', computeETag(updated)).code(200).send(updated);
    },
    deleteNotificationChannel: makeDelete(
      state.notificationChannels,
      'channelId',
      'notification_channel',
    ),
    listNotificationEvents: (c, _req, reply) => {
      const query = queryOf(c);
      const items = [...state.notificationEvents].sort((a, b) =>
        (a.attemptedAt ?? '') < (b.attemptedAt ?? '') ? 1 : -1,
      );
      const limit = query.limit ? Number.parseInt(query.limit, 10) : undefined;
      const page = paginate(items, {
        cursor: query.cursor,
        limit,
        sortKey: (e) => e.attemptedAt ?? '',
        id: (e) => e.id,
      });
      reply.code(200).send({ items: page.items, nextCursor: page.nextCursor });
    },
  };
}
