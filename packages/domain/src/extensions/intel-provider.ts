import type {
  CpeMatchCandidate,
  Vulnerability,
  VulnerabilityDataImport,
} from '../entities/vulnerability.js';
import type { UtcTimestamp } from '../primitives.js';

/**
 * EXT-02. Local offline bundle is the only implementation in this release
 * (Step 4.3). A subscription feed later is a second implementation of the same
 * interface — the pipeline's enrich stage never knows which one it's talking to.
 */
export interface IntelProvider {
  importBundle(bundlePath: string, signature: string): Promise<VulnerabilityDataImport>;
  lookupByCve(cveId: string): Promise<Vulnerability | null>;
  matchCpe(cpe: string, version: string | null): Promise<readonly CpeMatchCandidate[]>;
  /** OPS-03/P2-09: readyz degrades past the staleness threshold using this. */
  dataAge(): Promise<{ readonly sourceName: string; readonly ageInDays: number }[]>;
  currentAsOf(): Promise<UtcTimestamp>;
}
