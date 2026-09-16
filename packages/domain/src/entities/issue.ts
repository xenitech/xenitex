import type {
  AssetId,
  ConfidenceLabel,
  ExceptionId,
  IssueId,
  ObservationId,
  UnitInterval,
  Untrusted,
  UserId,
  UtcTimestamp,
  VulnerabilityId,
} from '../primitives.js';

/** MOD-10. `verified_resolved` is system-only (MOD-13); a user may reach every other state. */
export type IssueState =
  | 'new'
  | 'triaged'
  | 'in_progress'
  | 'mitigated'
  | 'verified_resolved'
  | 'reopened'
  | 'false_positive'
  | 'risk_accepted';

/** MOD-04. The deduplicated, human-facing unit of work. One row per stable fingerprint. */
export interface Issue {
  readonly id: IssueId;
  readonly fingerprint: string;
  readonly fingerprintVersion: number;
  readonly assetId: AssetId;
  /** Nullable: configuration and exposure issues have no CVE (MOD-04). */
  readonly vulnerabilityId: VulnerabilityId | null;
  readonly port: number | null;
  readonly protocol: string | null;
  readonly service: Untrusted<string> | null;
  readonly product: Untrusted<string> | null;
  readonly version: Untrusted<string> | null;
  readonly severity: 'info' | 'low' | 'medium' | 'high' | 'critical';
  readonly riskScore: number;
  readonly riskScorePolicyVersion: number;
  readonly confidence: UnitInterval;
  readonly confidenceLabel: ConfidenceLabel;
  readonly state: IssueState;
  readonly contributingObservationIds: readonly ObservationId[];
  readonly ownerUserId: UserId | null;
  readonly dueDate: UtcTimestamp | null;
  readonly exceptionId: ExceptionId | null;
  readonly firstSeen: UtcTimestamp;
  readonly lastSeen: UtcTimestamp;
  readonly lastVerifiedAt: UtcTimestamp | null;
}

/**
 * MOD-08. The fingerprint is a documented, versioned hash over a defined tuple.
 * See docs/adr/0002-issue-fingerprint.md for the tuple definition and the
 * migration story for version bumps. This type exists so every call site is
 * forced to go through computeFingerprint() rather than hand-rolling the hash.
 */
export interface FingerprintInput {
  readonly identityAnchor: string; // stable identity-key value chosen by identity-resolution precedence, never a bare address
  readonly vulnerabilityIdentifier: string | null; // vulnerabilities.vuln_identifier, or a stable issue-type key when null
  readonly port: number | null;
  readonly protocol: string | null;
}

export const CURRENT_FINGERPRINT_VERSION = 1;

export interface IssueStateTransition {
  readonly issueId: IssueId;
  readonly fromState: IssueState | null;
  readonly toState: IssueState;
  /** MOD-13: must be null when toState === 'verified_resolved' — enforced by the state machine, not just the DB CHECK. */
  readonly actorUserId: UserId | null;
  readonly reasonCode: string | null; // MOD-11: controlled vocabulary, required when toState === 'false_positive'
  readonly justification: string | null;
  readonly transitionedAt: UtcTimestamp;
}

/** MOD-12. Approver must differ from requester; expiry is mandatory. */
export interface Exception {
  readonly id: ExceptionId;
  readonly issueId: IssueId;
  readonly requestedBy: UserId;
  readonly justification: string;
  readonly approverUserId: UserId | null;
  readonly approvedAt: UtcTimestamp | null;
  readonly expiresAt: UtcTimestamp;
  readonly status: 'pending' | 'approved' | 'rejected' | 'expired' | 'revoked';
}

/** MOD-14. Policy matrix row: risk band x asset criticality -> due-within days. */
export interface SlaPolicy {
  readonly id: string;
  readonly riskBand: 'low' | 'medium' | 'high' | 'critical';
  readonly assetCriticality: 'low' | 'medium' | 'high' | 'critical';
  readonly dueWithinDays: number;
  readonly version: number;
}
