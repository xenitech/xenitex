import type { AssetCriticality, ExposureClassification } from '../entities/asset.js';
import type { RiskBand, UnitInterval, UtcTimestamp } from '../primitives.js';

export type { RiskBand };

/**
 * SCORE 2.3. Configurable per organisation (SCORE-05) — this is the shipped
 * default the seeded `risk_scoring_policies` row matches. Ordered
 * highest-first so `riskBand` can do a simple linear scan.
 */
export const DEFAULT_RISK_BANDS: readonly { readonly band: RiskBand; readonly minScore: number }[] =
  [
    { band: 'critical', minScore: 90 },
    { band: 'high', minScore: 70 },
    { band: 'medium', minScore: 40 },
    { band: 'low', minScore: 15 },
    { band: 'informational', minScore: 0 },
  ];

export function riskBand(
  score: number,
  bands: readonly { readonly band: RiskBand; readonly minScore: number }[] = DEFAULT_RISK_BANDS,
): RiskBand {
  // Sorted defensively rather than trusting the caller's ordering. The
  // linear scan below is only correct highest-first, and these bands are
  // configurable per organisation (SCORE-05) — they arrive from a JSON
  // column, where nothing preserves or enforces an order. An
  // ascending-order policy would have classified every single issue as
  // `informational`, silently, with no error anywhere.
  const ordered = [...bands].sort((a, b) => b.minScore - a.minScore);
  for (const b of ordered) if (score >= b.minScore) return b.band;
  return 'informational';
}

/**
 * docs/issues-scoring-dashboard-spec.md MATCH-08's evidence-fidelity tiers
 * (template-asserted CVE = verified; exact-version match = corroborated;
 * range match or backport-suspected = inferred) aren't implemented yet —
 * the pipeline still only produces a single numeric MOD-19 confidence
 * value. This derives the SCORE-04 tier from that number using the same
 * 0.75/0.4 boundaries `confidenceLabel` already uses elsewhere, which is a
 * documented approximation, not the real evidence-type classification
 * MATCH-08 describes.
 */
export function confidenceTierFromScore(confidence: UnitInterval): ConfidenceTier {
  if (confidence >= 0.75) return 'verified';
  if (confidence >= 0.4) return 'corroborated';
  return 'inferred';
}

export type ConfidenceTier = 'verified' | 'corroborated' | 'inferred';

/**
 * SCORE 2.2. Every input is already normalised by the caller:
 * `normalisedCvssBaseScore` is picked by SCORE-01/02's precedence (v4.0 >
 * v3.1 > v3.0 > v2, or a documented finding-class base when there is no
 * CVSS at all — MATCH-18: never a bare zero for "no score").
 */
export interface RiskFactors {
  readonly normalisedCvssBaseScore: number; // 0-10
  readonly cvssVersionUsed: string; // e.g. '3.1', or a finding-class key when there is no real CVSS
  readonly knownExploited: boolean;
  readonly exploitProbability: UnitInterval | null; // EPSS — read only when NOT known-exploited (SCORE 2.2's `exploit` factor)
  readonly exposureClassification: ExposureClassification;
  readonly assetCriticality: AssetCriticality;
  readonly confidenceTier: ConfidenceTier;
}

export interface RiskScoringWeights {
  /** SCORE 2.2 `exploit` factor. */
  readonly knownExploitedMultiplier: number; // 1.50
  readonly exploitProbabilityBaseMultiplier: number; // 1.00
  readonly exploitProbabilityScale: number; // 0.50 — exploit = base + (epss * scale)
  readonly exposure: Record<ExposureClassification, number>;
  readonly criticality: Record<AssetCriticality, number>;
  readonly confidence: Record<ConfidenceTier, number>;
}

export interface RiskScoringPolicy {
  readonly version: number;
  readonly weights: RiskScoringWeights;
  readonly isActive: boolean;
  readonly createdAt: UtcTimestamp;
}

/**
 * docs/issues-scoring-dashboard-spec.md SCORE 2.2, shipped defaults.
 * `external`/`unknown` aren't named in the spec's four-tier exposure list
 * (internet-facing/DMZ/internal/isolated) — this domain's
 * `ExposureClassification` predates that spec and additionally
 * distinguishes "known to be internal-only" from "exposure not yet
 * determined." `external` maps to the spec's "internet-facing"; `unknown`
 * is deliberately kept at the internal multiplier (1.00) — neither the
 * optimistic "isolated" (0.80) nor the pessimistic "internet-facing"
 * (1.30) assumption is honest when we simply don't know yet.
 */
export const DEFAULT_RISK_SCORING_WEIGHTS: RiskScoringWeights = {
  knownExploitedMultiplier: 1.5,
  exploitProbabilityBaseMultiplier: 1.0,
  exploitProbabilityScale: 0.5,
  exposure: { external: 1.3, dmz: 1.15, internal: 1.0, isolated: 0.8, unknown: 1.0 },
  criticality: { critical: 1.25, high: 1.1, medium: 1.0, low: 0.85 },
  confidence: { verified: 1.0, corroborated: 0.9, inferred: 0.75 },
};

export interface ScoreFactorContribution {
  readonly factor:
    | 'cvssBaseScore'
    | 'exploitProbability'
    | 'knownExploited'
    | 'exposureClassification'
    | 'assetCriticality'
    | 'confidence';
  /** Human-legible statement of the input this factor read, e.g. "9.8 (CVSS v3.1)", "internet-facing", "verified". */
  readonly inputDescription: string;
  readonly multiplier: number;
  /** The running product after this factor is applied — the last entry's value is always `totalScore` (MOD-17: nothing to keep in sync by hand). */
  readonly runningScore: number;
}

export interface RiskScoreResult {
  readonly totalScore: number; // 0-100
  readonly band: RiskBand;
  readonly policyVersion: number;
  /** MOD-17: what the UI renders in the one-screen "why this score" explanation. */
  readonly breakdown: readonly ScoreFactorContribution[];
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Guards a configurable weight lookup against a missing or non-finite value — see computeRiskScore. */
function requireWeight(value: number | undefined, factor: string, key: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(
      `computeRiskScore: risk scoring policy has no usable '${factor}' weight for '${key}'`,
    );
  }
  return value;
}

/**
 * docs/issues-scoring-dashboard-spec.md SCORE 2.2. Supersedes the
 * GATE-1-accepted weighted-sum function documented in
 * docs/adr/0004-risk-scoring-function.md (see that ADR's "Update" section)
 * — known-exploited status is now a multiplier on severity rather than an
 * additive term, so it scales with how bad the underlying CVE already is
 * (SCORE-03) instead of contributing a fixed amount regardless of
 * severity.
 */
export function computeRiskScore(factors: RiskFactors, policy: RiskScoringPolicy): RiskScoreResult {
  const { weights } = policy;

  const base = clamp(factors.normalisedCvssBaseScore, 0, 10) * 10;
  const exploitMultiplier = factors.knownExploited
    ? weights.knownExploitedMultiplier
    : weights.exploitProbabilityBaseMultiplier +
      (factors.exploitProbability ?? 0) * weights.exploitProbabilityScale;
  // Weights are configurable per organisation and reach this function as a
  // parsed JSON blob, so a key can legitimately be absent — a weights row
  // written before `ExposureClassification` gained a member, or an operator
  // PATCHing a partial object. `undefined` propagates silently through `*=`
  // and produces NaN, which then lands in issues.risk_score, sorts
  // unpredictably, and makes every ranking in the product meaningless
  // without raising anything. Fail loudly instead: an unscoreable issue is
  // a bug to fix, not a number to guess at (MOD-16).
  const exposureMultiplier = requireWeight(
    weights.exposure[factors.exposureClassification],
    'exposure',
    factors.exposureClassification,
  );
  const criticalityMultiplier = requireWeight(
    weights.criticality[factors.assetCriticality],
    'criticality',
    factors.assetCriticality,
  );
  const confidenceMultiplier = requireWeight(
    weights.confidence[factors.confidenceTier],
    'confidence',
    factors.confidenceTier,
  );

  let running = base;
  const breakdown: ScoreFactorContribution[] = [
    {
      factor: 'cvssBaseScore',
      inputDescription: `${factors.normalisedCvssBaseScore.toFixed(1)} (${factors.cvssVersionUsed})`,
      multiplier: 1, // the base itself, not yet multiplied by anything
      runningScore: running,
    },
  ];

  running *= exploitMultiplier;
  breakdown.push({
    factor: factors.knownExploited ? 'knownExploited' : 'exploitProbability',
    inputDescription: factors.knownExploited
      ? 'known-exploited'
      : `${(((factors.exploitProbability ?? 0) as number) * 100).toFixed(1)}% EPSS`,
    multiplier: exploitMultiplier,
    runningScore: running,
  });

  running *= exposureMultiplier;
  breakdown.push({
    factor: 'exposureClassification',
    inputDescription: factors.exposureClassification,
    multiplier: exposureMultiplier,
    runningScore: running,
  });

  running *= criticalityMultiplier;
  breakdown.push({
    factor: 'assetCriticality',
    inputDescription: factors.assetCriticality,
    multiplier: criticalityMultiplier,
    runningScore: running,
  });

  running *= confidenceMultiplier;
  breakdown.push({
    factor: 'confidence',
    inputDescription: factors.confidenceTier,
    multiplier: confidenceMultiplier,
    runningScore: running,
  });

  const totalScore = clamp(running, 0, 100);
  // clamp() only ever bites at the very top of the range in practice (max
  // multiplier stack is 1.5 * 1.3 * 1.25 * 1.0 ≈ 2.44x) — if it did clamp,
  // the last breakdown row's runningScore is corrected to match so the
  // "last row equals totalScore" invariant documented above always holds.
  if (breakdown.length > 0) {
    breakdown[breakdown.length - 1] = {
      ...breakdown[breakdown.length - 1]!,
      runningScore: totalScore,
    };
  }

  return { totalScore, band: riskBand(totalScore), policyVersion: policy.version, breakdown };
}

export interface AssetOpenIssueSummary {
  readonly issueId: string;
  readonly riskScore: number;
  readonly knownExploited: boolean;
}

export interface AssetRiskRatingResult {
  readonly rating: number; // 0-100
  readonly band: RiskBand;
  /** SCORE-08: the asset detail explains itself by naming these. */
  readonly maxRiskIssueId: string | null;
  readonly maxRisk: number;
  readonly breadthBonus: number;
  readonly breadthContributingIssueIds: readonly string[];
  readonly knownExploitedFloorApplied: boolean;
}

/**
 * docs/issues-scoring-dashboard-spec.md SCORE 2.4/SCORE-06/07/08. Pure
 * function over the asset's own currently-open issues — no I/O, matching
 * `computeRiskScore`'s own contract, so it's just as replayable.
 */
export function computeAssetRiskRating(
  openIssues: readonly AssetOpenIssueSummary[],
): AssetRiskRatingResult {
  if (openIssues.length === 0) {
    return {
      rating: 0,
      band: 'informational',
      maxRiskIssueId: null,
      maxRisk: 0,
      breadthBonus: 0,
      breadthContributingIssueIds: [],
      knownExploitedFloorApplied: false,
    };
  }

  let maxRisk = -Infinity;
  let maxRiskIssueId: string | null = null;
  for (const issue of openIssues) {
    if (issue.riskScore > maxRisk) {
      maxRisk = issue.riskScore;
      maxRiskIssueId = issue.issueId;
    }
  }

  const highOrAbove = openIssues.filter(
    (i) => riskBand(i.riskScore) === 'critical' || riskBand(i.riskScore) === 'high',
  );
  const breadthBonus = Math.min(10, 2 * Math.max(0, highOrAbove.length - 1));
  const breadthContributingIssueIds = highOrAbove
    .filter((i) => i.issueId !== maxRiskIssueId)
    .map((i) => i.issueId);

  let rating = clamp(maxRisk + breadthBonus, 0, 100);
  const anyKnownExploited = openIssues.some((i) => i.knownExploited);
  const knownExploitedFloorApplied = anyKnownExploited; // SCORE-06: reportable whenever true, not only when it changed the number
  if (anyKnownExploited && rating < 90) rating = 90;

  return {
    rating,
    band: riskBand(rating),
    maxRiskIssueId,
    maxRisk,
    breadthBonus,
    breadthContributingIssueIds,
    knownExploitedFloorApplied,
  };
}
