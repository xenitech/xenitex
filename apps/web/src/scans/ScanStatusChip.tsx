import { useTranslation } from 'react-i18next';
import styles from './ScanStatusChip.module.css';

type ScanRunStatus = 'queued' | 'running' | 'paused' | 'completed' | 'aborted' | 'failed';

const ICON: Record<ScanRunStatus, string> = {
  queued: '○',
  running: '◑',
  paused: '◐',
  completed: '●',
  aborted: '✕',
  failed: '✕',
};

const TONE: Record<ScanRunStatus, 'success' | 'failure' | undefined> = {
  queued: undefined,
  running: undefined,
  paused: undefined,
  completed: 'success',
  aborted: undefined,
  failed: 'failure',
};

/** Shape (icon), not colour, carries most states (UI-18) — failure is the one case that earns the risk-critical colour. */
export function ScanStatusChip({ status }: { readonly status: ScanRunStatus }) {
  const { t } = useTranslation();
  return (
    <span className={styles.chip} data-tone={TONE[status]}>
      <span aria-hidden="true">{ICON[status]}</span>
      {t(`scans.status.${status}`)}
    </span>
  );
}
