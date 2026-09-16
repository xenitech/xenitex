import type {
  AssetId,
  ObservationId,
  RiskBand,
  UnitInterval,
  Untrusted,
  UtcTimestamp,
} from '../primitives.js';

/** MOD-01. An address is never an identity (MOD-05) — see identity-resolution.ts for the service that populates identityKeys. */
export interface Asset {
  readonly id: AssetId;
  readonly lifecycleState: AssetLifecycleState;
  /** Set only when lifecycleState === 'merged'; points at the surviving asset. */
  readonly mergedIntoAssetId: AssetId | null;
  readonly identityKeys: readonly AssetIdentityKey[];
  readonly addresses: readonly AssetAddressHistoryEntry[];
  readonly hostnames: readonly AssetHostnameHistoryEntry[];
  readonly osInference: OsInference | null;
  readonly services: readonly AssetService[];
  readonly ownerTeam: string | null;
  readonly businessCriticality: AssetCriticality;
  readonly exposureClassification: ExposureClassification;
  readonly tags: readonly string[];
  readonly isFragile: boolean;
  readonly firstSeen: UtcTimestamp;
  readonly lastSeen: UtcTimestamp;
  /** docs/issues-scoring-dashboard-spec.md SCORE 2.4/SCORE-08 — null until the asset has at least one open issue. */
  readonly riskRating: number | null;
  readonly riskBand: RiskBand | null;
}

export type AssetLifecycleState = 'active' | 'inactive' | 'decommissioned' | 'merged';
export type AssetCriticality = 'low' | 'medium' | 'high' | 'critical';
/** 'isolated' added by docs/issues-scoring-dashboard-spec.md SCORE 2.2's four-tier exposure model. */
export type ExposureClassification = 'internal' | 'dmz' | 'external' | 'isolated' | 'unknown';

export type IdentityKeyType =
  'machine_uuid' | 'serial_number' | 'mac_address' | 'fqdn' | 'certificate_fingerprint';

/** MOD-05: each key carries its own source and confidence — never trusted uniformly. */
export interface AssetIdentityKey {
  readonly keyType: IdentityKeyType;
  readonly keyValue: Untrusted<string>;
  readonly sourceObservationId: ObservationId | null;
  readonly confidence: UnitInterval;
  readonly firstSeen: UtcTimestamp;
  readonly lastSeen: UtcTimestamp;
  readonly isActive: boolean;
}

export interface AssetAddressHistoryEntry {
  readonly address: string; // IPv4/IPv6 literal
  readonly firstSeen: UtcTimestamp;
  readonly lastSeen: UtcTimestamp;
  readonly isCurrent: boolean;
}

export interface AssetHostnameHistoryEntry {
  readonly hostname: Untrusted<string>;
  readonly firstSeen: UtcTimestamp;
  readonly lastSeen: UtcTimestamp;
  readonly isCurrent: boolean;
}

export interface OsInference {
  readonly label: Untrusted<string>;
  readonly confidence: UnitInterval;
}

export interface AssetService {
  readonly port: number;
  readonly protocol: string;
  readonly serviceName: Untrusted<string> | null;
  readonly product: Untrusted<string> | null;
  readonly version: Untrusted<string> | null;
  readonly firstSeen: UtcTimestamp;
  readonly lastSeen: UtcTimestamp;
  readonly isCurrent: boolean;
}

export interface AssetGroup {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly isDynamic: boolean;
  /** Present only when isDynamic; evaluated at read time, never materialised. */
  readonly dynamicFilter: Record<string, unknown> | null;
}
