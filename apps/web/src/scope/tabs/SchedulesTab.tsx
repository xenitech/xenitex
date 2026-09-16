import { useTranslation } from 'react-i18next';
import { EmptyState } from '../../components/EmptyState/EmptyState.js';
import { useScanSchedulesQuery } from '../useScopeQueries.js';
import styles from '../../components/layout/TabPanel.module.css';

/** Creating a schedule happens inline in the new-scan wizard's Schedule step (3.5) — this tab is the read register of what exists. */
export function SchedulesTab() {
  const { t } = useTranslation();
  const { data, isLoading } = useScanSchedulesQuery();

  if (isLoading) return <p>{t('common.loading')}</p>;
  if (!data?.items.length) {
    return <EmptyState title={t('scope.empty.schedules')} description="" />;
  }

  return (
    <div className={styles.list}>
      {data.items.map((schedule) => (
        <div key={schedule.id} className={styles.row}>
          <div className={styles.rowMain}>
            <strong>{schedule.name}</strong>
            <span className={styles.muted}>
              {schedule.cronExpression} ({schedule.timezone})
            </span>
          </div>
          <span className={styles.muted}>
            {schedule.isEnabled ? (schedule.nextRunAt ?? '—') : 'disabled'}
          </span>
        </div>
      ))}
    </div>
  );
}
