import type { ScoreFactorContribution } from '@xenitex/domain';
import { useTranslation } from 'react-i18next';
import styles from './RiskExplainer.module.css';

const FACTOR_KEY: Record<string, string> = {
  cvssBaseScore: 'factorCvssBaseScore',
  exploitProbability: 'factorExploitProbability',
  knownExploited: 'factorKnownExploited',
  exposureClassification: 'factorExposureClassification',
  assetCriticality: 'factorAssetCriticality',
  confidence: 'factorConfidence',
};

export interface RiskExplainerProps {
  /**
   * Typed as the current shape, but NOT trusted to be it — see
   * `isRenderableContribution`. This value is a `jsonb` blob written by
   * whichever version of the scoring function was active at the time.
   */
  readonly factors: readonly ScoreFactorContribution[];
  readonly scoringPolicyVersion: number;
}

/**
 * A stored breakdown row is only renderable if it actually carries the
 * fields this component reads.
 *
 * `issue_risk_score_snapshots.factor_breakdown` is a schema-less `jsonb`
 * column holding whatever the scoring function of the day produced. The
 * function changed from a weighted SUM (`{weight, rawValue, contribution}`)
 * to a multiplicative model (`{multiplier, runningScore}`) in migration
 * 0012, and the rows written before that were never migrated — so this
 * component was calling `.toFixed()` on `undefined` and taking the entire
 * application down with an unhandled TypeError, for any issue scored
 * before the change.
 *
 * Validating per row rather than trusting the TypeScript type is the point:
 * the type describes what the CURRENT function emits, and persisted data
 * outlives the code that wrote it.
 */
function isRenderableContribution(value: unknown): value is ScoreFactorContribution {
  if (typeof value !== 'object' || value === null) return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.factor === 'string' &&
    typeof row.multiplier === 'number' &&
    Number.isFinite(row.multiplier) &&
    typeof row.runningScore === 'number' &&
    Number.isFinite(row.runningScore)
  );
}

/**
 * UI-45 / MOD-17. The one-screen "why this score" explanation — a direct
 * render of issue_risk_score_snapshots.factor_breakdown, so there is no
 * separate explanation-generation step that could drift from what the
 * scoring function actually computed.
 *
 * docs/issues-scoring-dashboard-spec.md SCORE 2.2 made the scoring function
 * multiplicative (see docs/adr/0004-risk-scoring-function.md's "Update"):
 * each row states the input read, the multiplier it applied, and the
 * running score after — the last row always equals the issue's total risk
 * score, so nothing here can silently drift from computeRiskScore's own
 * arithmetic.
 *
 * When the stored breakdown predates that change (or is missing entirely),
 * this says so plainly instead of guessing. MOD-17 requires a score to be
 * explainable; an explanation reconstructed from incompatible inputs would
 * be worse than admitting we cannot produce one, because a sceptical
 * security engineer would have no way to tell the difference.
 */
export function RiskExplainer({ factors, scoringPolicyVersion }: RiskExplainerProps) {
  const { t } = useTranslation();

  const renderable = Array.isArray(factors) ? factors.filter(isRenderableContribution) : [];
  const total = Array.isArray(factors) ? factors.length : 0;

  if (renderable.length === 0) {
    return (
      <div>
        <p className={styles.unavailable}>
          {total === 0
            ? t('components.riskExplainer.unavailableNoBreakdown')
            : t('components.riskExplainer.unavailableLegacyFormat')}
        </p>
        <p className={styles.version}>
          {t('components.riskExplainer.version', { version: scoringPolicyVersion })}
        </p>
      </div>
    );
  }

  return (
    <div>
      <ul className={styles.list}>
        {renderable.map((factor) => (
          <li key={factor.factor} className={styles.row}>
            <span className={styles.label}>
              {/* An unrecognised factor name renders as itself rather than
                  as a missing-translation key — a future scoring input
                  should not blank out the row it appears in. */}
              {FACTOR_KEY[factor.factor]
                ? t(`components.riskExplainer.${FACTOR_KEY[factor.factor]}`)
                : factor.factor}
            </span>
            <span className={styles.contribution}>
              {factor.inputDescription} · ×{factor.multiplier.toFixed(2)} →{' '}
              {factor.runningScore.toFixed(1)}
            </span>
          </li>
        ))}
      </ul>
      {renderable.length < total && (
        // Partial data is reported, never silently trimmed: a breakdown
        // missing rows does not add up to the total score, and a reader
        // must not be left to discover that by doing the arithmetic.
        <p className={styles.unavailable}>
          {t('components.riskExplainer.partialBreakdown', {
            shown: renderable.length,
            total,
          })}
        </p>
      )}
      <p className={styles.version}>
        {t('components.riskExplainer.version', { version: scoringPolicyVersion })}
      </p>
    </div>
  );
}
