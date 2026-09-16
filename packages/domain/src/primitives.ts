/**
 * Shared primitives for the domain model. Kept dependency-free — this package
 * has no database, HTTP, or queue library in it (SCOPE-02: the domain model
 * must be usable from apps/api, apps/worker, and apps/web alike).
 */

/** Branded string type so an AssetId can never be silently accepted where an IssueId is expected. */
export type Brand<T, B extends string> = T & { readonly __brand: B };

export type AssetId = Brand<string, 'AssetId'>;
export type VulnerabilityId = Brand<string, 'VulnerabilityId'>;
export type ObservationId = Brand<string, 'ObservationId'>;
export type IssueId = Brand<string, 'IssueId'>;
export type UserId = Brand<string, 'UserId'>;
export type ScanRunId = Brand<string, 'ScanRunId'>;
export type ScanProfileId = Brand<string, 'ScanProfileId'>;
export type AuthorizedScopeId = Brand<string, 'AuthorizedScopeId'>;
export type ExclusionRuleId = Brand<string, 'ExclusionRuleId'>;
export type RawArtifactId = Brand<string, 'RawArtifactId'>;
export type AssetGroupId = Brand<string, 'AssetGroupId'>;
export type ExceptionId = Brand<string, 'ExceptionId'>;
export type ReportId = Brand<string, 'ReportId'>;
export type AuditEntryId = Brand<string, 'AuditEntryId'>;
export type SessionId = Brand<string, 'SessionId'>;

/** ISO-8601 UTC instant. Never a naive/local timestamp anywhere in the domain (DATA-06). */
export type UtcTimestamp = Brand<string, 'UtcTimestamp'>;

/**
 * A value that came from a scanned target and is therefore attacker-controlled
 * (SEC-17 / AIP-02). Wrapping it in a distinct type — rather than a bare `string` —
 * means a consumer must explicitly unwrap it, which is the seam a future output
 * encoder, log redactor, or prompt-injection fence hooks into.
 */
export type Untrusted<T> = { readonly untrusted: true; readonly value: T };
export function untrusted<T>(value: T): Untrusted<T> {
  return { untrusted: true, value };
}

/** 0.0-1.0 inclusive. Used for confidence, exploit_probability, fidelity_rating, weights. */
export type UnitInterval = Brand<number, 'UnitInterval'>;
export function unitInterval(n: number): UnitInterval {
  if (!Number.isFinite(n) || n < 0 || n > 1) {
    throw new RangeError(`UnitInterval must be within [0, 1], got ${n}`);
  }
  return n as UnitInterval;
}

export type ConfidenceLabel = 'low' | 'medium' | 'high';

/** Mirrors issues.confidence_label generated column (MOD-19/MOD-20) so UI and DB agree by construction. */
export function confidenceLabel(confidence: UnitInterval): ConfidenceLabel {
  if (confidence >= 0.75) return 'high';
  if (confidence >= 0.4) return 'medium';
  return 'low';
}

/**
 * docs/issues-scoring-dashboard-spec.md SCORE 2.3. Lives here (not in
 * scoring/risk-scoring.ts, which defines the actual banding logic) so both
 * entities/asset.ts (Asset.riskBand) and scoring/risk-scoring.ts can import
 * the type without one importing the other.
 */
export type RiskBand = 'critical' | 'high' | 'medium' | 'low' | 'informational';
