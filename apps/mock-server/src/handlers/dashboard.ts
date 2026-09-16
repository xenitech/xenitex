import type { AppState } from '../app-state.js';
import type { MockHandler } from './generic.js';

export function buildDashboardHandlers(state: AppState): Record<string, MockHandler> {
  return {
    getDashboard: (_c, _req, reply) => {
      const openIssues = state.issues
        .all()
        .filter((i) => i.state !== 'verified_resolved' && i.state !== 'false_positive');
      const byRiskBand: Record<string, number> = { critical: 0, high: 0, medium: 0, low: 0 };
      for (const issue of openIssues) {
        if (issue.riskScore >= 75) byRiskBand.critical!++;
        else if (issue.riskScore >= 50) byRiskBand.high!++;
        else if (issue.riskScore >= 25) byRiskBand.medium!++;
        else byRiskBand.low!++;
      }

      const exposureBreakdown: Record<string, number> = {};
      const criticalityBreakdown: Record<string, number> = {};
      for (const asset of state.assets.all()) {
        exposureBreakdown[asset.exposureClassification] =
          (exposureBreakdown[asset.exposureClassification] ?? 0) + 1;
        criticalityBreakdown[asset.businessCriticality] =
          (criticalityBreakdown[asset.businessCriticality] ?? 0) + 1;
      }

      const now = new Date().toISOString();
      const overdue = openIssues.filter((i) => i.dueDate != null && i.dueDate < now).length;
      const approachingDue = openIssues.filter((i) => {
        if (!i.dueDate || i.dueDate < now) return false;
        const days = (new Date(i.dueDate).getTime() - Date.now()) / 86_400_000;
        return days <= 7;
      }).length;

      const topIssues = [...openIssues].sort((a, b) => b.riskScore - a.riskScore).slice(0, 20);
      const activeScans = state.scanRuns
        .all()
        .filter((r) => r.status === 'running' || r.status === 'queued' || r.status === 'paused');

      const approachingExpiryWindowMs = 14 * 86_400_000;
      const exceptionsApproachingExpiry = state.exceptions
        .all()
        .filter(
          (e) =>
            e.status === 'approved' &&
            new Date(e.expiresAt).getTime() - Date.now() <= approachingExpiryWindowMs,
        )
        .sort((a, b) => (a.expiresAt < b.expiresAt ? -1 : 1));

      reply.code(200).send({
        riskPosture: { openIssuesByRiskBand: byRiskBand },
        topIssues,
        exposureBreakdown,
        criticalityBreakdown,
        slaCompliance: {
          onTrack: openIssues.length - overdue - approachingDue,
          approachingDue,
          overdue,
        },
        coverage: { assetsScannedLast30Days: state.assets.size, assetsTotal: state.assets.size },
        trend: Array.from({ length: 14 }, (_, i) => ({
          date: new Date(Date.now() - (13 - i) * 86_400_000).toISOString().slice(0, 10),
          openIssues: Math.max(0, openIssues.length - (13 - i) * 12),
        })),
        activeScans,
        exceptionsApproachingExpiry,
      });
    },
  };
}
