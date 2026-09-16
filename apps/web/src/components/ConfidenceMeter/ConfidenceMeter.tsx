import { useTranslation } from 'react-i18next';
import type { ConfidenceBand } from '../../design/tokens.js';
import styles from './ConfidenceMeter.module.css';

const SEGMENT_COUNT = 3;
const FILLED_BY_BAND: Record<ConfidenceBand, number> = {
  inferred: 1,
  corroborated: 2,
  verified: 3,
};

export interface ConfidenceMeterProps {
  readonly band: ConfidenceBand;
}

/** UI-46 / MOD-19 / MOD-20. Never coloured — see ConfidenceMeter.module.css for why. */
export function ConfidenceMeter({ band }: ConfidenceMeterProps) {
  const { t } = useTranslation();
  const filled = FILLED_BY_BAND[band];
  return (
    <span className={styles.meter}>
      <span className={styles.segments} aria-hidden="true">
        {Array.from({ length: SEGMENT_COUNT }, (_, index) => (
          <span key={index} className={styles.segment} data-filled={index < filled} />
        ))}
      </span>
      <span className={styles.word}>{t(`components.confidence.${band}`)}</span>
    </span>
  );
}
