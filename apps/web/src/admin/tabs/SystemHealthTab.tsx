import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { apiClient } from '../../api/client.js';
import { unwrap } from '../../api/error.js';
import { useSystemHealthQuery } from '../useAdminQueries.js';
import styles from '../../components/layout/TabPanel.module.css';
import healthStyles from './SystemHealthTab.module.css';

function useGlobalStopHistory() {
  return useQuery({
    queryKey: ['global-stop', 'history'],
    queryFn: async () =>
      unwrap(await apiClient.GET('/global-stop/history', { params: { query: { limit: 20 } } })),
  });
}

export function SystemHealthTab() {
  const { t } = useTranslation();
  const { data, isLoading } = useSystemHealthQuery();
  const history = useGlobalStopHistory();

  if (isLoading) return <p>{t('common.loading')}</p>;
  if (!data) return null;

  return (
    <div>
      <h2 className={styles.rowMain}>{t('admin.health.components')}</h2>
      <div className={styles.list}>
        {data.components.map((component) => (
          <div key={component.name} className={styles.row}>
            <strong>{component.name}</strong>
            <span className={healthStyles[component.status]}>{component.status}</span>
          </div>
        ))}
      </div>

      <div className={healthStyles.metrics}>
        <div>
          <span className={styles.muted}>{t('admin.health.vulnDataAge')}</span>
          <strong>{data.vulnerabilityDataAgeDays.toFixed(1)}d</strong>
        </div>
        <div>
          <span className={styles.muted}>{t('admin.health.diskHeadroom')}</span>
          <strong>{(data.diskHeadroomBytes / 1_000_000_000).toFixed(1)} GB</strong>
        </div>
        <div>
          <span className={styles.muted}>{t('admin.health.queueBacklog')}</span>
          <strong>{data.queueBacklog}</strong>
        </div>
        <div>
          <span className={styles.muted}>{t('admin.backup.lastBackup')}</span>
          <strong>{data.lastSuccessfulBackupAt ?? '—'}</strong>
        </div>
      </div>

      {data.degradedSubsystems.length > 0 && (
        <div className={healthStyles.degraded}>
          {t('admin.health.degraded')}: {data.degradedSubsystems.join(', ')}
        </div>
      )}

      <h2 className={styles.rowMain}>{t('admin.globalStop.history')}</h2>
      <div className={styles.list}>
        {history.data?.items.length === 0 && <span className={styles.muted}>—</span>}
        {history.data?.items.map((event) => (
          <div key={event.id} className={styles.row}>
            <div className={styles.rowMain}>
              <strong>{event.invokedAt}</strong>
              <span className={styles.muted}>
                {event.invokedVia} · {event.invokedByUserId ?? 'system'} · {event.reason ?? ''}
              </span>
            </div>
            <span className={styles.muted}>
              {t('admin.globalStop.halted', { count: event.scanRunsHalted.length })}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
