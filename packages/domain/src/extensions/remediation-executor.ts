import type { AssetId } from '../primitives.js';

/**
 * EXT-09. Interface signature ONLY. No implementation exists, none is planned
 * before Trust Rung 3 (Part E), and `scripts/assert-no-remediation-executor.mjs`
 * fails CI if any class other than the permanently-throwing stub below is found
 * to implement this interface, or if `feature_flags.remediation_executor_enabled`
 * is referenced anywhere as anything other than a hard-coded `false`.
 *
 * ANTI-10: no feature that writes to a customer system belongs in this release.
 * This type exists purely so the eventual Rung 3 interface has a stable shape to
 * land against — it must never be wired to anything that can act on it.
 */
export interface RemediationAction {
  readonly actionId: string; // closed catalogue entry, never freeform (see Rung 3 entry conditions)
  readonly targetAssetId: AssetId;
  readonly dryRun: boolean;
}

export interface RemediationExecutor {
  execute(_action: RemediationAction): Promise<never>;
}

export class UnavailableRemediationExecutor implements RemediationExecutor {
  execute(_action: RemediationAction): Promise<never> {
    throw new Error(
      'UnavailableRemediationExecutor: remediation execution does not exist in this product (PRIN-01/ANTI-10). ' +
        'See Part E (Trust Ladder), Rung 3, for the entry conditions that would ever justify building this.',
    );
  }
}
