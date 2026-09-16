import type {
  AuthorizedScopeId,
  ExclusionRuleId,
  ScanProfileId,
  ScanRunId,
  UserId,
  UtcTimestamp,
} from '../primitives.js';

/** SAFE-01. Immutable once accepted; "changing" a scope creates a new record. */
export interface AuthorizedScope {
  readonly id: AuthorizedScopeId;
  readonly name: string;
  readonly cidrRanges: readonly string[];
  readonly hostnames: readonly string[];
  readonly attestationType:
    'self_attested_owner' | 'delegated_authority' | 'contract_engagement' | 'other';
  readonly attestationDetails: string;
  readonly acceptedByUserId: UserId;
  readonly acceptedAt: UtcTimestamp;
  readonly supersededById: AuthorizedScopeId | null;
}

/** SAFE-02. Enforced at scan-plan validation AND again in the worker before dispatch. */
export interface ExclusionRule {
  readonly id: ExclusionRuleId;
  readonly scopeId: AuthorizedScopeId | null; // null = global
  readonly ruleType: 'address' | 'range' | 'port' | 'tag';
  readonly value: string;
  readonly reason: string;
  readonly createdBy: UserId;
  readonly isActive: boolean;
}

export type IntrusivenessProfile = 'passive-inventory' | 'safe' | 'standard';

/** SAFE-03/SAFE-04. Pacing may configure below PacingCeilings, never above. */
export interface PacingConfig {
  readonly packetsPerSecond: number;
  readonly concurrentHosts: number;
  readonly concurrentPortsPerHost: number;
  readonly timeoutMs: number;
  readonly retries: number;
}

export interface PacingCeilings {
  readonly maxPacketsPerSecond: number;
  readonly maxConcurrentHosts: number;
  readonly maxConcurrentPortsPerHost: number;
  readonly maxTimeoutMs: number;
  readonly maxRetries: number;
}

export interface ScanProfile {
  readonly id: ScanProfileId;
  readonly name: string;
  readonly intrusiveness: IntrusivenessProfile;
  readonly pacing: PacingConfig;
  /** true for 'standard' (SAFE-03): typed confirmation required, who confirmed is recorded. */
  readonly requiresConfirmation: boolean;
}

/** SAFE-05. On match: auto-downgrade to passive-inventory, flag fragile, surface a notice. Never auto-upgrade. */
export interface FragileDeviceRule {
  readonly id: string;
  readonly deviceClass: string; // e.g. 'printer', 'plc', 'medical_device', 'legacy_network_gear'
  readonly matchCriteria: Record<string, unknown>;
  readonly isEnabled: boolean;
}

/** SAFE-06. Global (scopeId null) or per-scope. A running scan pauses cleanly between hosts and resumes after. */
export interface BlackoutWindow {
  readonly id: string;
  readonly scopeId: AuthorizedScopeId | null;
  readonly startsAt: UtcTimestamp;
  readonly endsAt: UtcTimestamp;
  readonly isRecurring: boolean;
  readonly rrule: string | null;
}

/** SAFE-08. Scan creation returns this and requires confirming it before a scan_run is created. */
export interface ScanPlanPreview {
  readonly id: string;
  readonly scopeId: AuthorizedScopeId;
  readonly profileId: ScanProfileId;
  readonly targetCount: number;
  readonly estimatedPacketVolume: number;
  readonly estimatedDurationSeconds: number;
  readonly excludedTargets: readonly {
    readonly target: string;
    readonly ruleId: ExclusionRuleId;
  }[];
  readonly fragileDowngrades: readonly { readonly target: string; readonly deviceClass: string }[];
  readonly confirmedByUserId: UserId | null;
  readonly confirmedAt: UtcTimestamp | null;
}

export type ScanRunStatus = 'queued' | 'running' | 'paused' | 'completed' | 'aborted' | 'failed';

export interface ScanRun {
  readonly id: ScanRunId;
  readonly planPreviewId: string;
  readonly scopeId: AuthorizedScopeId;
  readonly profileId: ScanProfileId;
  readonly initiatedByUserId: UserId | null; // null if schedule-triggered
  readonly status: ScanRunStatus;
  readonly correlationId: string; // OPS-01: propagated HTTP request -> queue job -> scanner invocation
  readonly queuedAt: UtcTimestamp;
  readonly startedAt: UtcTimestamp | null;
  readonly completedAt: UtcTimestamp | null;
  readonly abortedByUserId: UserId | null;
}

export type ScanTargetStatus =
  | 'pending'
  | 'in_progress'
  | 'completed'
  | 'failed'
  | 'excluded'
  | 'skipped_blackout'
  | 'skipped_fragile_downgrade';

export interface ScanRunTarget {
  readonly id: string;
  readonly scanRunId: ScanRunId;
  readonly targetAddress: string;
  readonly targetPort: number | null;
  readonly status: ScanTargetStatus;
  readonly excludedByRuleId: ExclusionRuleId | null;
}

/** SAFE-07. One control, reachable from every screen, plus a documented CLI equivalent. */
export interface GlobalStopEvent {
  readonly id: string;
  readonly invokedByUserId: UserId | null; // null when invoked via the CLI under a service account (logged separately in auth_events)
  readonly invokedVia: 'web' | 'cli';
  readonly invokedAt: UtcTimestamp;
  readonly reason: string | null;
  readonly scanRunsHalted: readonly ScanRunId[];
}
