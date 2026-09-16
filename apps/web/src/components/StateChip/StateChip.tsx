import type { IssueState } from '@xenitex/domain';
import { useTranslation } from 'react-i18next';
import styles from './StateChip.module.css';

const CONFIG: Record<IssueState, { readonly icon: string; readonly tone?: 'success' }> = {
  new: { icon: '○' },
  triaged: { icon: '◐' },
  in_progress: { icon: '◑' },
  mitigated: { icon: '◒' },
  verified_resolved: { icon: '●', tone: 'success' },
  reopened: { icon: '↺' },
  false_positive: { icon: '✕' },
  risk_accepted: { icon: '⚑' },
};

export interface StateChipProps {
  readonly state: IssueState;
}

/** UI-49. Shape (icon) + label carry the state — colour is reserved for the one terminal-positive case (UI-18). */
export function StateChip({ state }: StateChipProps) {
  const { t } = useTranslation();
  const { icon, tone } = CONFIG[state];
  return (
    <span className={styles.chip} data-tone={tone}>
      <span className={styles.icon} aria-hidden="true">
        {icon}
      </span>
      {t(`components.state.${state}`)}
    </span>
  );
}
