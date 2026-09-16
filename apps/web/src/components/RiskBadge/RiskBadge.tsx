import type { ScoreFactorContribution } from '@xenitex/domain';
import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import type { RiskBand } from '../../design/tokens.js';
import { Popover } from '../primitives/Popover.js';
import { RiskExplainer } from '../RiskExplainer/RiskExplainer.js';
import styles from './RiskBadge.module.css';

const SEGMENT_COUNT = 5;

export interface RiskBadgeProps {
  readonly score: number; // 0-100
  readonly band: RiskBand;
  /** Omit to render the bar/score/label without the explainer popover (e.g. a read-only list export preview). */
  readonly explanation?: {
    readonly factors: readonly ScoreFactorContribution[];
    readonly scoringPolicyVersion: number;
  };
}

/** UI-44. Ordinal bar + numeric score + band label; focusable, reveals RiskExplainer on focus or hover (UI-06). */
export function RiskBadge({ score, band, explanation }: RiskBadgeProps) {
  const { t } = useTranslation();
  const bandLabel = t(`components.riskBadge.${band}`);
  const filledSegments = Math.min(
    SEGMENT_COUNT,
    Math.max(0, Math.ceil(score / (100 / SEGMENT_COUNT))),
  );
  const style = { '--segment-color': `var(--color-risk-${band})` } as CSSProperties;

  const content = (
    <span className={styles.badge} style={style}>
      <span className={styles.bar} aria-hidden="true">
        {Array.from({ length: SEGMENT_COUNT }, (_, index) => (
          <span key={index} className={styles.segment} data-filled={index < filledSegments} />
        ))}
      </span>
      <span className={styles.score}>{score}</span>
      <span className={styles.band}>{bandLabel}</span>
    </span>
  );

  if (!explanation) {
    return content;
  }

  return (
    <Popover
      trigger={content}
      label={t('components.riskBadge.explain', { score, band: bandLabel })}
    >
      <RiskExplainer
        factors={explanation.factors}
        scoringPolicyVersion={explanation.scoringPolicyVersion}
      />
    </Popover>
  );
}
