import type { AssetIdentityKey, IdentityKeyType } from '../entities/asset.js';
import type { AssetId, ObservationId, UnitInterval, UserId, UtcTimestamp } from '../primitives.js';

/**
 * MOD-05. An address is never an identity. This service resolves an observation's
 * extracted identity signals to a stable AssetId using a strict, versioned
 * precedence order over identity key types — see docs/adr/0003-identity-precedence.md.
 */
export interface IdentityResolutionPolicy {
  readonly version: number;
  /** Highest-precedence key type first. A match on an earlier entry always wins over a later one. */
  readonly precedenceOrder: readonly IdentityKeyType[];
  readonly mergeConfidenceThreshold: UnitInterval;
  readonly isActive: boolean;
}

export interface IdentityResolutionCandidate {
  readonly keyType: IdentityKeyType;
  readonly keyValue: string;
  readonly confidence: UnitInterval;
  readonly sourceObservationId: ObservationId;
}

export type IdentityResolutionOutcome =
  | {
      readonly kind: 'matched_existing';
      readonly assetId: AssetId;
      readonly matchedKey: AssetIdentityKey;
    }
  | { readonly kind: 'created_new'; readonly assetId: AssetId }
  | {
      readonly kind: 'low_confidence_candidate';
      readonly candidateAssetId: AssetId;
      readonly confidence: UnitInterval;
      // MOD-06: surfaced to the operator merge-review queue instead of auto-merging.
    };

/**
 * MOD-05/MOD-07. Deterministic: same inputs, same outcome, independent of call
 * order — required so the DHCP-churn fixture (three scans, one host, changing
 * address) is a stable, repeatable test rather than one that depends on timing.
 */
export interface IdentityResolutionService {
  resolve(
    candidates: readonly IdentityResolutionCandidate[],
    policy: IdentityResolutionPolicy,
  ): Promise<IdentityResolutionOutcome>;
}

/** MOD-06. Merges are recorded, reversible, and audited. */
export interface AssetMergeEvent {
  readonly id: string;
  readonly survivorAssetId: AssetId;
  readonly mergedAssetId: AssetId;
  readonly matchedIdentityKey: IdentityKeyType;
  readonly policyVersion: number;
  readonly confidence: UnitInterval;
  readonly performedBy: UserId | null; // null when system-automatic
  readonly performedAt: UtcTimestamp;
  readonly reversedBy: UserId | null;
  readonly reversedAt: UtcTimestamp | null;
  readonly reversalReason: string | null;
}

export interface AssetMergeService {
  merge(
    survivorAssetId: AssetId,
    mergedAssetId: AssetId,
    reason: IdentityResolutionOutcome,
    actor: UserId | null,
  ): Promise<AssetMergeEvent>;
  /** MOD-06: operator-driven correction of an incorrect automatic or manual merge. */
  reverse(mergeEventId: string, actor: UserId, reason: string): Promise<AssetMergeEvent>;
}
