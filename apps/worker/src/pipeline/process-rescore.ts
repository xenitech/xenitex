import type { Kysely } from 'kysely';
import type { DB } from '@xenitex/db';
import {
  computeRiskScore,
  confidenceTierFromScore,
  newId,
  riskBand,
  unitInterval,
  type RiskFactors,
  type RiskScoringPolicy,
} from '@xenitex/domain';
import type { WorkerDependencies } from '../dependencies.js';

/**
 * MOD-18: "Weight changes trigger a background recomputation that preserves
 * each issue's historical score snapshot."
 *
 * Nothing performed that recomputation. `POST /risk-scoring-policies`
 * published new weights and `GET /risk-scoring-policies/{version}/
 * recompute-status` reported progress by counting issues already carrying
 * the version — a number that could only ever move if something rescored
 * them, and nothing did. Publishing new weights changed how NEW issues were
 * scored and left every existing issue frozen at the old policy, so the
 * Issues list silently mixed two incompatible scoring functions and sorted
 * them against each other as if they were comparable.
 *
 * This reconciles continuously rather than being kicked off by the publish
 * endpoint: the worker looks for issues whose `risk_score_policy_version`
 * differs from the active policy and brings them forward. That makes it
 * self-healing — a recompute interrupted by a restart simply resumes, and
 * issues left behind by an older build (including ones carrying a
 * pre-migration-0012 breakdown, or no snapshot at all) are repaired without
 * anyone having to know they existed.
 */

/** Bounded so reconciliation shares the worker with scanning instead of monopolising it. */
const RESCORE_BATCH_SIZE = 200;

type IssueSeverity = 'info' | 'low' | 'medium' | 'high' | 'critical';

function severityFromRiskBand(band: ReturnType<typeof riskBand>): IssueSeverity {
  return band === 'informational' ? 'info' : band;
}

/**
 * Mirrors the pipeline's own fallback (see process-scan-run.ts): a missing
 * CVSS must never be treated as zero, because a literal 0 base zeroes the
 * entire multiplicative score regardless of every other factor.
 */
function fallbackCvssBase(knownExploited: boolean): { score: number; version: string } {
  return knownExploited
    ? { score: 7.0, version: 'no-cvss-known-exploited-default' }
    : { score: 5.0, version: 'no-cvss-default' };
}

async function activePolicy(db: Kysely<DB>): Promise<RiskScoringPolicy | null> {
  const row = await db
    .selectFrom('risk_scoring_policies')
    .selectAll()
    .where('is_active', '=', true)
    .executeTakeFirst();
  if (!row) return null;
  return {
    version: row.version,
    weights: row.weights as never,
    isActive: true,
    createdAt: row.created_at.toString() as never,
  };
}

export interface RescoreOutcome {
  readonly rescored: number;
  readonly remaining: number;
  readonly policyVersion: number | null;
}

export async function processRescoreBatch(deps: WorkerDependencies): Promise<RescoreOutcome> {
  const { db } = deps;
  const policy = await activePolicy(db);
  if (!policy) return { rescored: 0, remaining: 0, policyVersion: null };

  const stale = await db
    .selectFrom('issues')
    .leftJoin('vulnerabilities', 'vulnerabilities.id', 'issues.vulnerability_id')
    .innerJoin('assets', 'assets.id', 'issues.asset_id')
    .select([
      'issues.id',
      'issues.confidence',
      'issues.asset_id',
      'assets.business_criticality',
      'assets.exposure_classification',
      'vulnerabilities.cvss_base_score',
      'vulnerabilities.cvss_version',
      'vulnerabilities.exploit_probability',
      'vulnerabilities.known_exploited',
    ])
    .where('issues.risk_score_policy_version', '!=', policy.version)
    .orderBy('issues.id', 'asc')
    .limit(RESCORE_BATCH_SIZE)
    .execute();

  if (stale.length === 0) return { rescored: 0, remaining: 0, policyVersion: policy.version };

  let rescored = 0;
  for (const issue of stale) {
    try {
      const knownExploited = issue.known_exploited ?? false;
      const usedFallback = issue.cvss_base_score === null;
      const fallback = usedFallback ? fallbackCvssBase(knownExploited) : null;

      const factors: RiskFactors = {
        normalisedCvssBaseScore:
          issue.cvss_base_score === null ? fallback!.score : Number(issue.cvss_base_score),
        cvssVersionUsed: issue.cvss_version ?? fallback?.version ?? 'unknown',
        exploitProbability:
          issue.exploit_probability === null
            ? null
            : unitInterval(Number(issue.exploit_probability)),
        knownExploited,
        exposureClassification: issue.exposure_classification,
        assetCriticality: issue.business_criticality,
        confidenceTier: confidenceTierFromScore(unitInterval(Number(issue.confidence))),
      };

      const result = computeRiskScore(factors, policy);

      await db.transaction().execute(async (trx) => {
        await trx
          .updateTable('issues')
          .set({
            risk_score: String(result.totalScore) as never,
            risk_score_policy_version: policy.version,
            severity: severityFromRiskBand(result.band),
            updated_at: new Date(),
          })
          .where('id', '=', issue.id)
          // Guard against a concurrent rescore of the same row.
          .where('risk_score_policy_version', '!=', policy.version)
          .execute();

        // MOD-18: the previous snapshot is PRESERVED, never overwritten —
        // a new row is appended so the score's history stays auditable and
        // an operator can see what a weight change actually did.
        await trx
          .insertInto('issue_risk_score_snapshots')
          .values({
            id: newId(),
            issue_id: issue.id,
            scoring_policy_version: policy.version,
            total_score: String(result.totalScore) as never,
            factor_breakdown: JSON.stringify(result.breakdown) as never,
            trigger: 'weights_changed',
          })
          .execute();
      });
      rescored += 1;
    } catch (error) {
      // One unscoreable issue (e.g. a policy missing a weight for this
      // asset's exposure class, which computeRiskScore refuses to guess at)
      // must not stall reconciliation for every other issue.
      console.error(`worker: failed to rescore issue ${issue.id}`, error);
    }
  }

  const remainingRow = await db
    .selectFrom('issues')
    .select((eb) => eb.fn.countAll().as('count'))
    .where('risk_score_policy_version', '!=', policy.version)
    .executeTakeFirstOrThrow();

  return {
    rescored,
    remaining: Number(remainingRow.count),
    policyVersion: policy.version,
  };
}
