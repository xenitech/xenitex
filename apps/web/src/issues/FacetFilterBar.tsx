import { useTranslation } from 'react-i18next';
import type { IssueState } from '../api/types.js';
import type { IssueFilters } from './useIssuesQueries.js';
import styles from './FacetFilterBar.module.css';

const STATES: readonly IssueState[] = [
  'new',
  'triaged',
  'in_progress',
  'mitigated',
  'verified_resolved',
  'reopened',
  'false_positive',
  'risk_accepted',
];

export interface FacetFilterBarProps {
  readonly filters: IssueFilters;
  readonly onChange: (next: Partial<IssueFilters>) => void;
}

export function FacetFilterBar({ filters, onChange }: FacetFilterBarProps) {
  const { t } = useTranslation();

  const toggleState = (state: IssueState) => {
    const has = filters.state.includes(state);
    onChange({ state: has ? filters.state.filter((s) => s !== state) : [...filters.state, state] });
  };

  return (
    <div className={styles.bar}>
      <div className={styles.chips} role="group" aria-label={t('issues.filters.state')}>
        {STATES.map((state) => (
          <button
            key={state}
            type="button"
            className={styles.chip}
            data-active={filters.state.includes(state)}
            onClick={() => toggleState(state)}
          >
            {t(`components.state.${state}`)}
          </button>
        ))}
      </div>
      <label className={styles.control}>
        {t('issues.confidenceFloor')}
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={filters.confidenceFloor}
          onChange={(e) => onChange({ confidenceFloor: Number(e.target.value) })}
        />
        <span>{filters.confidenceFloor.toFixed(2)}</span>
      </label>
      <label className={styles.control}>
        <input
          type="checkbox"
          checked={filters.overdue}
          onChange={(e) => onChange({ overdue: e.target.checked })}
        />
        {t('issues.filters.overdue')}
      </label>
    </div>
  );
}
