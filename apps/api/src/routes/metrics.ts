import type { FastifyInstance } from 'fastify';
import { sql } from '@xenitex/db';
import type { ApiDependencies } from '../dependencies.js';

/**
 * OPS-02. Prometheus text exposition on the API container's own port,
 * which is only reachable inside the compose `internal`/`edge` networks —
 * nginx proxies `/v1/` and nothing else, so this is never exposed to a
 * browser the way the panel is, and it deliberately carries no session
 * check for the same reason `/healthz` does not: a scrape agent is not a
 * user.
 *
 * Nothing here leaves the appliance (DATA-07). These are counts and gauges
 * for the customer's own monitoring, pulled by the customer's own
 * Prometheus if they run one; there is no push, no remote write, and no
 * identifying content — no addresses, no hostnames, no finding text.
 */

function escapeLabelValue(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('\n', '\\n');
}

interface Metric {
  readonly name: string;
  readonly help: string;
  readonly type: 'gauge' | 'counter';
  readonly samples: readonly { readonly labels?: Record<string, string>; readonly value: number }[];
}

function render(metrics: readonly Metric[]): string {
  const lines: string[] = [];
  for (const metric of metrics) {
    lines.push(`# HELP ${metric.name} ${metric.help}`);
    lines.push(`# TYPE ${metric.name} ${metric.type}`);
    for (const sample of metric.samples) {
      const labels = sample.labels
        ? `{${Object.entries(sample.labels)
            .map(([k, v]) => `${k}="${escapeLabelValue(v)}"`)
            .join(',')}}`
        : '';
      // A NaN/Infinity here would make the whole scrape unparseable, so a
      // non-finite value is reported as 0 rather than poisoning the page.
      const value = Number.isFinite(sample.value) ? sample.value : 0;
      lines.push(`${metric.name}${labels} ${value}`);
    }
  }
  return lines.join('\n') + '\n';
}

export async function registerMetricsRoutes(
  app: FastifyInstance,
  deps: ApiDependencies,
): Promise<void> {
  const { db } = deps;

  app.get('/metrics', async (_request, reply) => {
    const [
      scanRunsByStatus,
      queueOldest,
      issuesByState,
      issuesBySeverity,
      overdueIssues,
      targetsByStatus,
      assetCount,
      observationCount,
      pendingReports,
      pendingNotifications,
      intelAge,
      poolStats,
    ] = await Promise.all([
      db
        .selectFrom('scan_runs')
        .select(['status', (eb) => eb.fn.countAll().as('count')])
        .groupBy('status')
        .execute(),
      db
        .selectFrom('scan_runs')
        .select(sql<number>`extract(epoch from (now() - min(queued_at)))`.as('age_seconds'))
        .where('status', '=', 'queued')
        .executeTakeFirst(),
      db
        .selectFrom('issues')
        .select(['state', (eb) => eb.fn.countAll().as('count')])
        .groupBy('state')
        .execute(),
      db
        .selectFrom('issues')
        .select(['severity', (eb) => eb.fn.countAll().as('count')])
        .where('state', 'in', ['new', 'triaged', 'in_progress', 'reopened'])
        .groupBy('severity')
        .execute(),
      db
        .selectFrom('issues')
        .select((eb) => eb.fn.countAll().as('count'))
        .where('due_date', '<', sql`current_date` as never)
        .where('state', 'in', ['new', 'triaged', 'in_progress', 'reopened'])
        .executeTakeFirst(),
      db
        .selectFrom('scan_run_targets')
        .select(['status', (eb) => eb.fn.countAll().as('count')])
        .groupBy('status')
        .execute(),
      db
        .selectFrom('assets')
        .select((eb) => eb.fn.countAll().as('count'))
        .executeTakeFirst(),
      db
        .selectFrom('observations')
        .select((eb) => eb.fn.countAll().as('count'))
        .executeTakeFirst(),
      db
        .selectFrom('reports')
        .select((eb) => eb.fn.countAll().as('count'))
        .where('status', '=', 'pending')
        .executeTakeFirst(),
      db
        .selectFrom('notification_events')
        .select((eb) => eb.fn.countAll().as('count'))
        .where('status', '=', 'pending')
        .executeTakeFirst(),
      db
        .selectFrom('vulnerability_data_imports')
        .select(sql<number>`extract(epoch from (now() - max(imported_at)))`.as('age_seconds'))
        .where('status', '=', 'applied')
        .executeTakeFirst(),
      // OPS-02 names connection pool saturation explicitly; pg exposes it
      // on the pool object rather than through SQL.
      Promise.resolve(
        (db as unknown as { getExecutor?: () => unknown }).getExecutor
          ? ((
              deps as unknown as {
                pool?: { totalCount: number; idleCount: number; waitingCount: number };
              }
            ).pool ?? null)
          : null,
      ),
    ]);

    const metrics: Metric[] = [
      {
        name: 'xenitex_scan_runs',
        help: 'Scan runs by status.',
        type: 'gauge',
        samples: scanRunsByStatus.map((row) => ({
          labels: { status: String(row.status) },
          value: Number(row.count),
        })),
      },
      {
        name: 'xenitex_scan_queue_oldest_age_seconds',
        help: 'Age of the oldest queued scan run. Queue depth is meaningless without it — one stuck job looks identical to a healthy backlog.',
        type: 'gauge',
        samples: [{ value: Number(queueOldest?.age_seconds ?? 0) }],
      },
      {
        name: 'xenitex_scan_run_targets',
        help: 'Scan run targets by status, including excluded and out-of-scope refusals (SAFE-01/SAFE-02).',
        type: 'gauge',
        samples: targetsByStatus.map((row) => ({
          labels: { status: String(row.status) },
          value: Number(row.count),
        })),
      },
      {
        name: 'xenitex_issues',
        help: 'Issues by lifecycle state.',
        type: 'gauge',
        samples: issuesByState.map((row) => ({
          labels: { state: String(row.state) },
          value: Number(row.count),
        })),
      },
      {
        name: 'xenitex_open_issues_by_severity',
        help: 'Open issues by severity band.',
        type: 'gauge',
        samples: issuesBySeverity.map((row) => ({
          labels: { severity: String(row.severity) },
          value: Number(row.count),
        })),
      },
      {
        name: 'xenitex_open_issues_overdue',
        help: 'Open issues past their SLA due date (MOD-14).',
        type: 'gauge',
        samples: [{ value: Number(overdueIssues?.count ?? 0) }],
      },
      {
        name: 'xenitex_assets',
        help: 'Assets known to the appliance.',
        type: 'gauge',
        samples: [{ value: Number(assetCount?.count ?? 0) }],
      },
      {
        name: 'xenitex_observations',
        help: 'Retained observations (DATA-04 retention target).',
        type: 'gauge',
        samples: [{ value: Number(observationCount?.count ?? 0) }],
      },
      {
        name: 'xenitex_pending_reports',
        help: 'Report generation jobs awaiting a worker.',
        type: 'gauge',
        samples: [{ value: Number(pendingReports?.count ?? 0) }],
      },
      {
        name: 'xenitex_pending_notifications',
        help: 'Notification deliveries awaiting a worker.',
        type: 'gauge',
        samples: [{ value: Number(pendingNotifications?.count ?? 0) }],
      },
      {
        name: 'xenitex_vulnerability_data_age_seconds',
        help: 'Age of the most recent applied vulnerability data import. Drives OPS-03 readiness degradation; -1 when no import has ever been applied.',
        type: 'gauge',
        samples: [{ value: Number(intelAge?.age_seconds ?? -1) }],
      },
    ];

    if (poolStats) {
      metrics.push({
        name: 'xenitex_db_pool_connections',
        help: 'Postgres connection pool saturation.',
        type: 'gauge',
        samples: [
          { labels: { state: 'total' }, value: poolStats.totalCount },
          { labels: { state: 'idle' }, value: poolStats.idleCount },
          { labels: { state: 'waiting' }, value: poolStats.waitingCount },
        ],
      });
    }

    return reply
      .code(200)
      .header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
      .send(render(metrics));
  });
}
