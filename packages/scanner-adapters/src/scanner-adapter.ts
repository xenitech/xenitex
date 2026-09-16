import type {
  AuthorizedScope,
  ExclusionRule,
  IntrusivenessProfile,
  Observation,
  PacingConfig,
  RawArtifact,
  ScanPlanPreview,
  ScanProfile,
} from '@xenitex/domain';

/**
 * P2-01. The adapter boundary is the seam that keeps LEG-03 true: any bundled
 * component that fails licence review (LEG-02 — Nmap/NPSL is the live question)
 * can be swapped or shipped as a customer-installed add-on by implementing this
 * interface again, with zero changes anywhere else in the codebase.
 *
 * Concrete adapters (network-discovery, template-checks — P2-04/P2-05) are Step 4
 * work; this file fixes the shape they must have so the pipeline (4.4) and the
 * scan-run orchestration (apps/worker) can be built against it now.
 */

export interface AdapterCapabilities {
  readonly adapterKey: string;
  readonly version: string;
  /** Declared, not measured at runtime — see docs/adr for how fidelity feeds MOD-19 confidence. */
  readonly fidelityRating: number; // 0-1
  readonly supportedIntrusiveness: readonly ScanProfile['intrusiveness'][];
  /** SEC-12: the exhaustive allowlist of flags this adapter may ever pass to its underlying binary. */
  readonly permittedFlags: readonly string[];
}

export interface PlanValidationInput {
  readonly scope: AuthorizedScope;
  readonly exclusions: readonly ExclusionRule[];
  readonly profile: ScanProfile;
}

export type PlanValidationResult =
  { readonly valid: true } | { readonly valid: false; readonly reason: string };

export interface EstimateResult {
  readonly targetCount: number;
  readonly estimatedPacketVolume: number;
  readonly estimatedDurationSeconds: number;
}

export type AdapterProgressEvent =
  | { readonly kind: 'target_started'; readonly target: string }
  | { readonly kind: 'target_completed'; readonly target: string }
  | { readonly kind: 'target_failed'; readonly target: string; readonly failureClass: string };

export interface ExecutionContext {
  readonly scanRunId: string;
  readonly pacing: PacingConfig;
  /** SAFE-03: the adapter must pick its technique/port-range/scripts from this, not from the plan alone. */
  readonly intrusiveness: IntrusivenessProfile;
  /** SEC-03: per-job working directory, discarded after artifact upload — the adapter never chooses its own path. */
  readonly workingDirectory: string;
  readonly jobTimeoutMs: number;
  readonly outputSizeCapBytes: number;
}

/**
 * `target` was added while wiring the first real implementation
 * (TcpConnectDiscoveryAdapter, apps/worker's pipeline): a single execute()
 * call batches many targets into one underlying scanner invocation (running
 * one process per host would make PERF-03's /16 window unreachable), so each
 * yielded outcome must self-identify which host it's for rather than relying
 * on the caller to zip an implicit target list against iteration order.
 */
export type TargetOutcome =
  | { readonly status: 'completed'; readonly target: string; readonly rawArtifact: RawArtifact }
  | {
      readonly status: 'failed';
      readonly target: string;
      readonly failureClass: string;
      readonly partialArtifact: RawArtifact | null;
    };

/**
 * P2-01/P2-02/P2-03. Adapter failure is a first-class outcome: execute() never
 * throws on a per-target failure, it reports it via TargetOutcome so partial
 * results are retained and the failure is classified rather than losing the run.
 */
export interface ScannerAdapter {
  capabilities(): AdapterCapabilities;
  validatePlan(input: PlanValidationInput): Promise<PlanValidationResult>;
  estimate(input: PlanValidationInput): Promise<EstimateResult>;
  /**
   * `targets` is the batch this call covers (the caller chunks the full
   * pending-target list, sized to the profile's pacing.concurrentHosts) —
   * added alongside `TargetOutcome.target` for the same reason (see above).
   */
  execute(
    targets: readonly string[],
    plan: ScanPlanPreview,
    context: ExecutionContext,
    onProgress: (event: AdapterProgressEvent) => void,
  ): AsyncIterable<TargetOutcome>;
  /**
   * SEC-17/P2-04/P2-05: parsers consume structured output only (XML/JSON/JSONL),
   * never screen-scraped text, and every extracted string is wrapped Untrusted<T>
   * before it leaves this method.
   */
  parse(artifact: RawArtifact): Promise<readonly Observation[]>;
}
