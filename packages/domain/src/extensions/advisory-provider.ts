import type { AssetCriticality, ExposureClassification } from '../entities/asset.js';
import type { IssueId, UnitInterval, Untrusted } from '../primitives.js';

/**
 * EXT-03 + F.1 (AIP-01..AIP-05). Implemented now as the deterministic
 * rules/knowledge-base engine of Step 4.7 (RuleBasedAdvisoryProvider, in
 * apps/api). A future model-backed implementation satisfies this exact
 * interface — every constraint below exists so that swap is possible without
 * ever giving a model an execution path.
 */

/**
 * AIP-01. Strictly typed, minimal, redacted context — never raw scanner output,
 * never a whole report. maxContextBytes is enforced by the caller before this
 * object is constructed, not trusted after the fact.
 */
export interface AdvisoryContext {
  readonly issueId: IssueId;
  readonly issueType: string; // stable category key, not free text
  readonly cveIds: readonly string[];
  readonly cvssBaseScore: number | null;
  readonly assetCriticality: AssetCriticality;
  readonly exposureClassification: ExposureClassification;
  /**
   * AIP-02/SEC-17: anything that came from a scanned target must arrive here
   * already wrapped — this field cannot be populated with a bare string, by type.
   */
  readonly untrustedEvidenceExcerpt: Untrusted<string> | null;
}

export const ADVISORY_CONTEXT_MAX_BYTES = 4096;

/**
 * AIP-03. Closed output type: a selection from an enumerated, versioned set of
 * advisory identifiers plus explanatory text, with no field that could ever be
 * interpreted as a command, file path, or shell argument. Free-form output
 * reaching an execution surface is impossible by type, because there is no
 * execution surface anywhere this type flows to (PRIN-01/ANTI-10).
 */
export interface AdvisoryRecommendation {
  readonly advisoryId: string; // foreign key into remediation_guidance, never freeform
  readonly rationale: string; // display-only explanatory text
  readonly confidence: UnitInterval;
}

export interface AdvisoryProvider {
  recommend(context: AdvisoryContext): Promise<AdvisoryRecommendation>;
}

/**
 * AIP-04. Deterministic validator between any provider output and any consumer.
 * Runs against BOTH the rule-based implementation and any future model-backed
 * one — the rule-based engine is not exempt just because it's deterministic
 * by construction, since the validator is also what enforces organisational
 * policy (e.g. an advisory disabled by the customer), not just type safety.
 */
export interface AdvisoryValidator {
  validate(
    recommendation: AdvisoryRecommendation,
    context: AdvisoryContext,
  ): Promise<AdvisoryRecommendation | { readonly rejected: true; readonly reason: string }>;
}

/** AIP-05: satisfiable entirely inside the customer's network; product remains fully functional when disabled. */
export class NotImplementedAdvisoryProvider implements AdvisoryProvider {
  recommend(_context: AdvisoryContext): Promise<AdvisoryRecommendation> {
    throw new Error(
      'NotImplementedAdvisoryProvider: no model-backed AdvisoryProvider exists in this release (v2.0, see Appendix). ' +
        'Use RuleBasedAdvisoryProvider from apps/api instead.',
    );
  }
}
