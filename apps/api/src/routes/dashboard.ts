import type { FastifyInstance } from 'fastify';
import { sql } from '@xenitex/db';
import type { ApiDependencies } from '../dependencies.js';
import { requireSession } from './auth.js';
import { issueSelect, toIssue, type IssueRow } from './issues.js';
import { scanRunSelect, toScanRun, type ScanRunRow } from './scans.js';

const OPEN_ISSUE_STATES = ['new', 'triaged', 'in_progress', 'reopened'] as const;
const APPROACHING_DUE_WINDOW_DAYS = 3;

export async function registerDashboardRoutes(
  app: FastifyInstance,
  deps: ApiDependencies,
): Promise<void> {
  const { db } = deps;

  app.get('/dashboard', { preHandler: requireSession(deps) }, async (_request, reply) => {
    const [
      riskBandRows,
      topIssueRows,
      exposureRows,
      criticalityRows,
      slaRows,
      assetsTotalRow,
      assetsScannedRow,
      activeScanRows,
    ] = await Promise.all([
      db
        .selectFrom('issues')
        .select(['severity', (eb) => eb.fn.countAll().as('count')])
        .where('state', 'in', OPEN_ISSUE_STATES)
        .groupBy('severity')
        .execute(),
      issueSelect(db)
        .where('issues.state', 'in', OPEN_ISSUE_STATES)
        .orderBy('issues.risk_score', 'desc')
        .orderBy('issues.id', 'asc')
        .limit(10)
        .execute(),
      db
        .selectFrom('assets')
        .select(['exposure_classification', (eb) => eb.fn.countAll().as('count')])
        .groupBy('exposure_classification')
        .execute(),
      db
        .selectFrom('assets')
        .select(['business_criticality', (eb) => eb.fn.countAll().as('count')])
        .groupBy('business_criticality')
        .execute(),
      db
        .selectFrom('issues')
        .select([
          sql<number>`count(*) filter (where due_date is null or due_date >= now() + interval '${sql.raw(
            String(APPROACHING_DUE_WINDOW_DAYS),
          )} days')`.as('on_track'),
          sql<number>`count(*) filter (where due_date is not null and due_date >= now() and due_date < now() + interval '${sql.raw(
            String(APPROACHING_DUE_WINDOW_DAYS),
          )} days')`.as('approaching_due'),
          sql<number>`count(*) filter (where due_date is not null and due_date < now())`.as(
            'overdue',
          ),
        ])
        .where('state', 'in', OPEN_ISSUE_STATES)
        .executeTakeFirstOrThrow(),
      db
        .selectFrom('assets')
        .select((eb) => eb.fn.countAll().as('count'))
        .executeTakeFirstOrThrow(),
      // Coverage proxy: assets.last_seen is touched by identity resolution
      // whenever a scan observes that asset, so "seen in the last 30 days"
      // is a reasonable stand-in for "scanned in the last 30 days" without
      // joining scan_run_targets' free-text target_address back to a
      // specific asset_id (no direct FK exists between them).
      db
        .selectFrom('assets')
        .select((eb) => eb.fn.countAll().as('count'))
        .where('last_seen', '>=', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000))
        .executeTakeFirstOrThrow(),
      scanRunSelect(db)
        .where('scan_runs.status', 'in', ['queued', 'running', 'paused'])
        .orderBy('scan_runs.queued_at', 'desc')
        .execute(),
    ]);

    const openIssuesByRiskBand: Record<string, number> = {};
    for (const row of riskBandRows) {
      openIssuesByRiskBand[row.severity] = Number(row.count);
    }
    const exposureBreakdown: Record<string, number> = {};
    for (const row of exposureRows) {
      exposureBreakdown[row.exposure_classification] = Number(row.count);
    }
    const criticalityBreakdown: Record<string, number> = {};
    for (const row of criticalityRows) {
      criticalityBreakdown[row.business_criticality] = Number(row.count);
    }

    return reply.code(200).send({
      riskPosture: { openIssuesByRiskBand },
      topIssues: topIssueRows.map((row) => toIssue(row as IssueRow)),
      exposureBreakdown,
      criticalityBreakdown,
      slaCompliance: {
        onTrack: Number(slaRows.on_track),
        approachingDue: Number(slaRows.approaching_due),
        overdue: Number(slaRows.overdue),
      },
      coverage: {
        assetsScannedLast30Days: Number(assetsScannedRow.count),
        assetsTotal: Number(assetsTotalRow.count),
      },
      activeScans: activeScanRows.map((row) => toScanRun(row as ScanRunRow)),
    });
  });
}
