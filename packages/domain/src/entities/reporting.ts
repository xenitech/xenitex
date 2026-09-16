import type { ReportId, UserId, UtcTimestamp } from '../primitives.js';

export type ReportTemplate = 'executive_summary' | 'technical_detail' | 'delta';

/** 4.8: every report embeds the data/scoring versions it used so it is reproducible. */
export interface Report {
  readonly id: ReportId;
  readonly template: ReportTemplate;
  readonly scopeFilter: Record<string, unknown>;
  readonly dateRangeStart: UtcTimestamp | null; // 'delta' template only
  readonly dateRangeEnd: UtcTimestamp | null;
  readonly status: 'pending' | 'completed' | 'failed';
  readonly dataVersions: {
    readonly vulnerabilityDataImportId: string;
    readonly riskScoringPolicyVersion: number;
  } | null;
  readonly formats: readonly ('html' | 'csv' | 'json')[];
  readonly blobStoreKey: string | null;
  readonly generatedBy: UserId;
  readonly generatedAt: UtcTimestamp;
}

export type NotificationChannelType = 'email' | 'webhook';

export interface NotificationChannel {
  readonly id: string;
  readonly type: NotificationChannelType;
  readonly config: Record<string, unknown>; // non-secret only; secrets live behind secretRef (SEC-05)
  readonly secretRef: string | null;
  readonly isEnabled: boolean;
}

export type NotificationEventType =
  'scan_completed' | 'new_high_risk_issue' | 'sla_breach' | 'exception_expiry' | 'system_degraded';

export interface NotificationEvent {
  readonly id: string;
  readonly channelId: string;
  readonly eventType: NotificationEventType;
  readonly mode: 'immediate' | 'digest';
  readonly payload: Record<string, unknown>;
  readonly status: 'pending' | 'sent' | 'failed';
}

/** EXT-07. All feature gating routes through this so packaging changes touch one place. Server-side only (SEC-13). */
export interface FeatureFlagService {
  isEnabled(key: string): Promise<boolean>;
  setEnabled(key: string, enabled: boolean, actor: UserId): Promise<void>;
}
