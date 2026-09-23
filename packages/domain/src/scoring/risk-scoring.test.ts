import assert from 'node:assert/strict';
import { describe, it, test } from 'node:test';
import {
  computeAssetRiskRating,
  computeRiskScore,
  confidenceTierFromScore,
  DEFAULT_RISK_SCORING_WEIGHTS,
  riskBand,
  type RiskFactors,
  type RiskScoringPolicy,
} from './risk-scoring.js';
import { unitInterval, type UtcTimestamp } from '../primitives.js';

const policy: RiskScoringPolicy = {
  version: 2,
  weights: DEFAULT_RISK_SCORING_WEIGHTS,
  isActive: true,
  createdAt: new Date().toISOString() as UtcTimestamp,
};

function closeTo(actual: number, expected: number, tolerance = 0.05): void {
  assert.ok(Math.abs(actual - expected) < tolerance, `expected ~${expected}, got ${actual}`);
}

test('SCORE-03: known-exploited status compounds with severity, at the same severity it outranks an unexploited issue', () => {
  const shared = {
    exposureClassification: 'internal',
    assetCriticality: 'medium',
    confidenceTier: 'corroborated',
  } as const;
  const unexploited: RiskFactors = {
    ...shared,
    normalisedCvssBaseScore: 7.0,
    cvssVersionUsed: '3.1',
    knownExploited: false,
    exploitProbability: unitInterval(0.2),
  };
  const knownExploited: RiskFactors = {
    ...shared,
    normalisedCvssBaseScore: 7.0,
    cvssVersionUsed: '3.1',
    knownExploited: true,
    exploitProbability: unitInterval(0.2),
  };
  const a = computeRiskScore(unexploited, policy);
  const b = computeRiskScore(knownExploited, policy);
  closeTo(a.totalScore, 69.3);
  closeTo(b.totalScore, 94.5);
  assert.ok(b.totalScore > a.totalScore);
});

test('SCORE-03 (ADR-0004 update): unlike the superseded weighted-sum function, known-exploited status on a LOW-severity issue does not flatten the ranking above a genuinely severe unexploited one', () => {
  const lowSeverityExploited: RiskFactors = {
    normalisedCvssBaseScore: 2.0,
    cvssVersionUsed: '3.1',
    knownExploited: true,
    exploitProbability: null,
    exposureClassification: 'internal',
    assetCriticality: 'medium',
    confidenceTier: 'verified',
  };
  const highSeverityUnexploited: RiskFactors = {
    normalisedCvssBaseScore: 9.0,
    cvssVersionUsed: '3.1',
    knownExploited: false,
    exploitProbability: unitInterval(0.1),
    exposureClassification: 'internal',
    assetCriticality: 'medium',
    confidenceTier: 'verified',
  };
  const low = computeRiskScore(lowSeverityExploited, policy);
  const high = computeRiskScore(highSeverityUnexploited, policy);
  closeTo(low.totalScore, 30);
  closeTo(high.totalScore, 94.5);
  assert.ok(high.totalScore > low.totalScore);
});

test('MOD-17: the last breakdown row always equals totalScore exactly (multiplicative model, no separate sum to keep in sync)', () => {
  const factors: RiskFactors = {
    normalisedCvssBaseScore: 7.2,
    cvssVersionUsed: '3.1',
    knownExploited: false,
    exploitProbability: unitInterval(0.4),
    exposureClassification: 'dmz',
    assetCriticality: 'medium',
    confidenceTier: 'corroborated',
  };
  const result = computeRiskScore(factors, policy);
  closeTo(result.totalScore, 89.424, 0.01);
  assert.equal(result.breakdown[result.breakdown.length - 1]!.runningScore, result.totalScore);
  assert.equal(result.policyVersion, policy.version);
  assert.equal(result.band, 'high');
});

test('SCORE-04: confidence reduces the score but never suppresses it — inferred (0.75x) never zeroes a real finding', () => {
  const factors: RiskFactors = {
    normalisedCvssBaseScore: 6.0,
    cvssVersionUsed: '2.0',
    knownExploited: true,
    exploitProbability: null,
    exposureClassification: 'internal',
    assetCriticality: 'medium',
    confidenceTier: 'inferred',
  };
  const result = computeRiskScore(factors, policy);
  closeTo(result.totalScore, 67.5);
  assert.ok(result.totalScore > 0);
});

test('finiteness: a zero base score and null exploit probability never produce NaN', () => {
  const factors: RiskFactors = {
    normalisedCvssBaseScore: 0,
    cvssVersionUsed: 'finding-class',
    knownExploited: false,
    exploitProbability: null,
    exposureClassification: 'internal',
    assetCriticality: 'low',
    confidenceTier: 'inferred',
  };
  const result = computeRiskScore(factors, policy);
  assert.ok(Number.isFinite(result.totalScore));
  assert.equal(result.band, 'informational');
});

test('SCORE 2.3: risk band boundaries are inclusive at the stated floor', () => {
  assert.equal(riskBand(90), 'critical');
  assert.equal(riskBand(89.99), 'high');
  assert.equal(riskBand(70), 'high');
  assert.equal(riskBand(69.99), 'medium');
  assert.equal(riskBand(40), 'medium');
  assert.equal(riskBand(39.99), 'low');
  assert.equal(riskBand(15), 'low');
  assert.equal(riskBand(14.99), 'informational');
  assert.equal(riskBand(0), 'informational');
});

test("confidenceTierFromScore boundaries match confidenceLabel(low/medium/high)'s existing 0.4/0.75 thresholds", () => {
  assert.equal(confidenceTierFromScore(unitInterval(0.75)), 'verified');
  assert.equal(confidenceTierFromScore(unitInterval(0.74)), 'corroborated');
  assert.equal(confidenceTierFromScore(unitInterval(0.4)), 'corroborated');
  assert.equal(confidenceTierFromScore(unitInterval(0.39)), 'inferred');
});

test('SCORE-06: the known-exploited floor lifts the asset rating to at least 90, and names which issue triggered it', () => {
  const result = computeAssetRiskRating([
    { issueId: 'issue-low', riskScore: 20, knownExploited: true },
    { issueId: 'issue-medium', riskScore: 55, knownExploited: false },
  ]);
  assert.equal(result.rating, 90);
  assert.equal(result.band, 'critical');
  assert.equal(result.knownExploitedFloorApplied, true);
  assert.equal(result.maxRiskIssueId, 'issue-medium');
  assert.equal(result.maxRisk, 55);
});

test('SCORE-07: breadth bonus is capped at 10 regardless of how many High-or-above issues pile on', () => {
  const manyHighIssues = Array.from({ length: 20 }, (_, i) => ({
    issueId: `issue-${i}`,
    riskScore: 75, // high band
    knownExploited: false,
  }));
  const result = computeAssetRiskRating(manyHighIssues);
  assert.equal(result.breadthBonus, 10);
  assert.equal(result.rating, 85); // 75 (max) + 10 (capped bonus), no known-exploited floor
  assert.equal(result.knownExploitedFloorApplied, false);
});

test('SCORE-05 (2.4 example): a single severe issue is not diluted by a long tail of low-severity ones beside it', () => {
  const result = computeAssetRiskRating([
    { issueId: 'the-rce', riskScore: 95, knownExploited: false },
    ...Array.from({ length: 30 }, (_, i) => ({
      issueId: `low-${i}`,
      riskScore: 20,
      knownExploited: false,
    })),
  ]);
  // Only one issue is High-or-above (the RCE itself) -- breadth counts issues
  // BESIDE the max, so 30 low-severity issues contribute nothing.
  assert.equal(result.breadthBonus, 0);
  assert.equal(result.rating, 95);
  assert.equal(result.maxRiskIssueId, 'the-rce');
});

test('an asset with no open issues rates informational, not an error', () => {
  const result = computeAssetRiskRating([]);
  assert.equal(result.rating, 0);
  assert.equal(result.band, 'informational');
  assert.equal(result.maxRiskIssueId, null);
});

describe('risk scoring policy robustness', () => {
  const factors = {
    normalisedCvssBaseScore: 9.8,
    cvssVersionUsed: '3.1',
    knownExploited: false,
    exploitProbability: null,
    exposureClassification: 'external',
    assetCriticality: 'high',
    confidenceTier: 'verified',
  } as const;

  // Regression: these weights arrive as a parsed jsonb blob, so a key can
  // simply be absent. `undefined` used to flow straight into `running *= …`
  // and write NaN to issues.risk_score — every ranking in the product
  // silently meaningless, with nothing logged.
  it('refuses to score against a policy missing a weight rather than producing NaN', () => {
    const policy = {
      version: 99,
      isActive: true,
      createdAt: '2026-01-01T00:00:00Z' as never,
      weights: {
        ...DEFAULT_RISK_SCORING_WEIGHTS,
        exposure: { dmz: 1.15, internal: 1.0, isolated: 0.8, unknown: 1.0 } as never,
      },
    };
    assert.throws(() => computeRiskScore(factors, policy), /no usable 'exposure' weight/);
  });

  // Regression: riskBand's linear scan is only correct highest-first, and
  // configured bands come out of JSON with no ordering guarantee. Given an
  // ascending list it returned 'informational' for every score.
  it('bands correctly regardless of the order the configured bands arrive in', () => {
    const ascending = [
      { band: 'informational' as const, minScore: 0 },
      { band: 'low' as const, minScore: 15 },
      { band: 'medium' as const, minScore: 40 },
      { band: 'high' as const, minScore: 70 },
      { band: 'critical' as const, minScore: 90 },
    ];
    assert.equal(riskBand(95, ascending), 'critical');
    assert.equal(riskBand(72, ascending), 'high');
    assert.equal(riskBand(5, ascending), 'informational');
  });
});
