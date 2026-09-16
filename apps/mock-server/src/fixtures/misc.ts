import { createHash } from 'node:crypto';
import type { components } from '@xenitex/contracts';
import type { Rng } from './rng.js';

type Report = components['schemas']['Report'];
type NotificationChannel = components['schemas']['NotificationChannel'];
type NotificationEvent = components['schemas']['NotificationEvent'];
type AuditEntry = components['schemas']['AuditEntry'];
type BackupRecord = components['schemas']['BackupRecord'];
type AssetGroup = components['schemas']['AssetGroup'];
type SavedView = components['schemas']['SavedView'];
type GlobalStopEvent = components['schemas']['GlobalStopEvent'];
type Asset = components['schemas']['Asset'];

const NOW = Date.now();
const daysAgo = (days: number) => new Date(NOW - days * 86_400_000).toISOString();

export function generateReports(rng: Rng, userIds: readonly string[]): Report[] {
  const templates = ['executive_summary', 'technical_detail', 'delta'] as const;
  return Array.from({ length: 15 }, (_, i) => {
    const template = templates[i % templates.length]!;
    const generatedDaysAgo = rng.int(1, 90);
    return {
      id: `report-${i}`,
      template,
      scopeFilter: {},
      dateRangeStart: template === 'delta' ? daysAgo(generatedDaysAgo + 30).slice(0, 10) : null,
      dateRangeEnd: template === 'delta' ? daysAgo(generatedDaysAgo).slice(0, 10) : null,
      status: 'completed' as const,
      dataVersions: { vulnerabilityDataImportId: 'import-nvd-1', riskScoringPolicyVersion: 1 },
      formats: ['html', 'csv'] as const,
      blobStoreKey: `reports/${template}-${i}.html`,
      generatedBy: rng.pick(userIds),
      generatedAt: daysAgo(generatedDaysAgo),
      completedAt: daysAgo(generatedDaysAgo - 0.01),
    };
  });
}

export function generateNotifications(rng: Rng): {
  channels: NotificationChannel[];
  events: NotificationEvent[];
} {
  const channels: NotificationChannel[] = [
    {
      id: 'channel-email-secops',
      type: 'email',
      config: { addresses: ['secops@pilot-customer.example'] },
      secretRef: null,
      isEnabled: true,
    },
    {
      id: 'channel-webhook-slack',
      type: 'webhook',
      config: { url: 'https://hooks.example.internal/xenitex' },
      secretRef: 'secret-ref-webhook-1',
      isEnabled: true,
    },
  ];
  const eventTypes = [
    'scan_completed',
    'new_high_risk_issue',
    'sla_breach',
    'exception_expiry',
    'system_degraded',
  ] as const;
  const events: NotificationEvent[] = Array.from({ length: 50 }, (_, i) => ({
    id: `notif-event-${i}`,
    channelId: rng.pick(channels).id,
    eventType: rng.pick(eventTypes),
    mode: rng.pick(['immediate', 'digest'] as const),
    status: rng.weightedPick([
      ['sent', 90],
      ['pending', 5],
      ['failed', 5],
    ] as const),
    attemptedAt: daysAgo(rng.int(0, 60)),
    deliveredAt: daysAgo(rng.int(0, 60)),
    error: null,
  }));
  return { channels, events };
}

/** DATA-02: same hash-chain shape the real audit log uses (entryHash = sha256(canonicalPayload || prevEntryHash)). */
export function generateAuditEntries(rng: Rng, userIds: readonly string[]): AuditEntry[] {
  const actions = [
    'issue.transition',
    'scan_run.create',
    'exception.approve',
    'user.login',
    'scope.create',
    'global_stop.invoke',
  ];
  const entries: AuditEntry[] = [];
  let prevHash = '0'.repeat(64);
  for (let i = 0; i < 500; i++) {
    const canonicalPayload = { action: rng.pick(actions), seq: i };
    const entryHash = createHash('sha256')
      .update(JSON.stringify(canonicalPayload) + prevHash)
      .digest('hex');
    entries.push({
      id: i + 1,
      actorUserId: rng.boolean(0.9) ? rng.pick(userIds) : null,
      sessionId: null,
      sourceAddress: `10.0.0.${rng.int(1, 254)}`,
      action: canonicalPayload.action,
      targetType: canonicalPayload.action.split('.')[0]!,
      targetId: `${canonicalPayload.action.split('.')[0]}-${rng.int(0, 999)}`,
      beforeState: null,
      afterState: null,
      outcome: rng.weightedPick([
        ['success', 95],
        ['denied', 3],
        ['failure', 2],
      ] as const),
      occurredAt: daysAgo(rng.int(0, 120)),
      prevEntryHash: prevHash,
      entryHash,
    });
    prevHash = entryHash;
  }
  return entries;
}

export function generateBackupRecords(rng: Rng): BackupRecord[] {
  return Array.from({ length: 10 }, (_, i) => {
    const startedDaysAgo = i;
    return {
      id: `backup-${i}`,
      startedAt: daysAgo(startedDaysAgo + 0.01),
      completedAt: daysAgo(startedDaysAgo),
      status: 'completed' as const,
      archiveLocation: `/var/backups/xenitex/backup-${i}.tar.gz.enc`,
      sizeBytes: rng.int(500_000_000, 4_000_000_000),
      encrypted: true,
      restoreTestedAt: i === 0 ? daysAgo(0.5) : null,
      measuredRpoSeconds: 3600,
      measuredRtoSeconds: 1800,
    };
  });
}

export function generateAssetGroups(rng: Rng, assets: readonly Asset[]): AssetGroup[] {
  const names = ['PCI Scope', 'Internet-Facing', 'Crown Jewels', 'Decommission Candidates'];
  return names.map((name, i) => ({
    id: `group-${i}`,
    name,
    description: `Assets tagged or classified as ${name.toLowerCase()}.`,
    isDynamic: i % 2 === 0,
    dynamicFilter: i % 2 === 0 ? { tag: name.toLowerCase().replaceAll(' ', '-') } : null,
    ...(i % 2 === 0 ? {} : { memberCount: Math.min(assets.length, rng.int(5, 40)) }),
  }));
}

export function generateSavedViews(userId: string): SavedView[] {
  return [
    {
      id: 'view-overdue-critical',
      name: 'Overdue critical issues',
      query: 'state=triaged,in_progress,reopened&overdue=true&sort=riskScore',
      isShared: true,
      createdBy: userId,
    },
    {
      id: 'view-high-confidence',
      name: 'High-confidence new issues',
      query: 'state=new&confidenceFloor=0.75&sort=riskScore',
      isShared: true,
      createdBy: userId,
    },
  ];
}

export function generateGlobalStopHistory(userId: string): GlobalStopEvent[] {
  return [
    {
      id: 'global-stop-1',
      invokedByUserId: userId,
      invokedVia: 'web',
      invokedAt: daysAgo(45),
      reason: 'Suspected impact on a production database during a standard-profile scan.',
      scanRunsHalted: ['scanrun-3', 'scanrun-4'],
    },
  ];
}
