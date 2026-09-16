import type {
  AssetId,
  ObservationId,
  RawArtifactId,
  ScanRunId,
  Untrusted,
  UtcTimestamp,
} from '../primitives.js';

/**
 * MOD-03. One immutable statement by one adapter in one scan run.
 * Never updated or deleted except by the retention job (DATA-04) — there is no
 * `update()` operation in the repository interface for this entity, by design.
 */
export interface Observation {
  readonly id: ObservationId;
  readonly scanRunId: ScanRunId;
  readonly scannerAdapterKey: string;
  readonly scannerAdapterVersion: string;
  readonly rawArtifactId: RawArtifactId;
  readonly targetAddress: string;
  readonly targetPort: number | null;
  readonly targetProtocol: string | null;
  /** Null until the identity-resolution pipeline stage assigns it. */
  readonly resolvedAssetId: AssetId | null;
  /** Fields the adapter is structurally confident in (e.g. "port": 443, "state": "open"). */
  readonly extractedAttributes: Record<string, unknown>;
  /**
   * SEC-17: banners, page titles, certificate subjects, headers — anything that
   * came from the scanned target. Every value here is wrapped in Untrusted<T> at
   * the point of construction; there is no plain-string escape hatch in this shape.
   */
  readonly untrustedEvidence: Record<string, Untrusted<string>>;
  readonly observedAt: UtcTimestamp;
}

export interface RawArtifact {
  readonly id: RawArtifactId;
  readonly scanRunId: ScanRunId;
  readonly scannerAdapterKey: string;
  readonly blobStoreKey: string;
  readonly contentType: string;
  readonly sizeBytes: number;
  readonly sha256: string;
  readonly capturedAt: UtcTimestamp;
}
