import type { RawArtifact } from '../entities/observation.js';
import type { ScanRunId } from '../primitives.js';

/**
 * EXT-04. The pipeline accepts observations from any source, not only a scanner
 * adapter running locally. This is the one interface that lets remote
 * collectors, an endpoint agent, and imported third-party scanner results all
 * arrive later (v1.2+) without the ingest/parse/normalise pipeline (4.4) ever
 * changing shape — it only ever consumes ObservationSource, never a concrete
 * adapter type.
 */
export interface RawObservationInput {
  readonly scanRunId: ScanRunId;
  readonly scannerAdapterKey: string;
  readonly scannerAdapterVersion: string;
  readonly rawPayload: Buffer;
  readonly contentType: string;
}

export interface ObservationSource {
  readonly sourceKey: string; // e.g. 'local-adapter', 'remote-collector', 'imported-third-party'
  collect(scanRunId: ScanRunId): AsyncIterable<RawObservationInput>;
  /** Persists the raw payload to the BlobStore and returns the reference the pipeline's ingest stage requires (DATA-01). */
  storeArtifact(input: RawObservationInput): Promise<RawArtifact>;
}

/** In this release, the only registered ObservationSource wraps the local adapter framework (P2-01..P2-05). */
export interface LocalAdapterObservationSource extends ObservationSource {
  readonly sourceKey: 'local-adapter';
}
