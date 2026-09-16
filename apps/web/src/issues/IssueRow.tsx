import { useTranslation } from 'react-i18next';
import { RiskBadge } from '../components/RiskBadge/RiskBadge.js';
import { ConfidenceMeter } from '../components/ConfidenceMeter/ConfidenceMeter.js';
import { StateChip } from '../components/StateChip/StateChip.js';
import type { Issue } from '../api/types.js';
import { confidenceLabelToBand } from './confidenceBand.js';
import styles from './IssueRow.module.css';

export interface IssueRowProps {
  readonly issue: Issue;
  readonly isSelected: boolean;
  readonly isFocused?: boolean;
  readonly onSelect: () => void;
}

/** Wireframe (docs/design/wireframe-issues.md): risk bar+score+title wraps to a second line; confidence folds under the asset name rather than its own column. */
export function IssueRow({ issue, isSelected, isFocused, onSelect }: IssueRowProps) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      className={styles.row}
      data-selected={isSelected}
      data-focused={isFocused}
      onClick={onSelect}
      aria-current={isSelected ? 'true' : undefined}
    >
      <div className={styles.riskColumn}>
        <RiskBadge score={Math.round(issue.riskScore)} band={issue.severity} />
        <span className={styles.title}>{issue.title ?? t('common.unknown')}</span>
        {/* MOD-04: a configuration/exposure issue legitimately has no CVE — say so, don't leave a blank cell. */}
        <span className={styles.cve}>{issue.primaryCveId ?? t('issues.noCve')}</span>
      </div>
      <div className={styles.assetColumn}>
        {/* SEC-17: asset hostname/address is scanner-derived, untrusted — plain text child only, never HTML. */}
        <span className={styles.asset}>{issue.assetLabelUntrusted}</span>
        <ConfidenceMeter band={confidenceLabelToBand(issue.confidenceLabel)} />
        <StateChip state={issue.state} />
      </div>
    </button>
  );
}
