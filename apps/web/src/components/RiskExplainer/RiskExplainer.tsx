import type { ScoreFactorContribution } from '@xenitex/domain';
import { useTranslation } from 'react-i18next';
import styles from './RiskExplainer.module.css';

const FACTOR_KEY: Record<ScoreFactorContribution['factor'], string> = {
  cvssBaseScore: 'factorCvssBaseScore',
  exploitProbability: 'factorExploitProbability',
  knownExploited: 'factorKnownExploited',
  exposureClassification: 'factorExposureClassification',
  assetCriticality: 'factorAssetCriticality',
  confidence: 'factorConfidence',
};

export interface RiskExplainerProps {
  readonly factors: readonly ScoreFactorContribution[];
  readonly scoringPolicyVersion: number;
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
 * arithmetic. An additive "+/-" delta (the previous version of this
 * component) would misrepresent a multiplicative factor.
 */
export function RiskExplainer({ factors, scoringPolicyVersion }: RiskExplainerProps) {
  const { t } = useTranslation();
  return (
    <div>
      <ul className={styles.list}>
        {factors.map((factor) => (
          <li key={factor.factor} className={styles.row}>
            <span className={styles.label}>
              {t(`components.riskExplainer.${FACTOR_KEY[factor.factor]}`)}
            </span>
            <span className={styles.contribution}>
              {factor.inputDescription} · ×{factor.multiplier.toFixed(2)} → {factor.runningScore.toFixed(1)}
            </span>
          </li>
        ))}
      </ul>
      <p className={styles.version}>
        {t('components.riskExplainer.version', { version: scoringPolicyVersion })}
      </p>
    </div>
  );
}
