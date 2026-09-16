import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { EmptyState } from '../components/EmptyState/EmptyState.js';
import { ErrorState } from '../components/ErrorState/ErrorState.js';
import { Button } from '../components/form/Button.js';
import { ApiError } from '../api/error.js';
import { flattenPages } from '../api/pagination.js';
import { ScanStatusChip } from './ScanStatusChip.js';
import { useScanRunsQuery } from './useScansQueries.js';
import styles from './ScansPage.module.css';

export function ScansPage() {
  const { t } = useTranslation();
  const query = useScanRunsQuery();
  const runs = useMemo(() => flattenPages(query.data?.pages), [query.data]);

  if (query.isError) {
    const apiErr = query.error instanceof ApiError ? query.error : undefined;
    return (
      <ErrorState
        title={t('components.errorState.title')}
        detail={apiErr?.detail ?? ''}
        code={apiErr?.code ?? 'unknown'}
        correlationId={apiErr?.correlationId ?? 'unavailable'}
      />
    );
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>{t('scans.title')}</h1>
        <Link to="/scans/new">
          <Button variant="primary">{t('scans.newScan')}</Button>
        </Link>
      </div>
      {!query.isLoading && runs.length === 0 ? (
        <EmptyState title={t('scans.empty.title')} description={t('scans.empty.description')} />
      ) : (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>{t('scans.columns.id')}</th>
              <th>{t('scans.columns.status')}</th>
              <th>{t('scans.columns.progress')}</th>
              <th>{t('scans.columns.started')}</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((run) => (
              <tr key={run.id}>
                <td>
                  <Link to={`/scans/${run.id}`}>{run.id}</Link>
                </td>
                <td>
                  <ScanStatusChip status={run.status} />
                </td>
                <td>
                  {t('scans.run.progress', {
                    completed: run.targetsCompleted ?? 0,
                    total: run.targetsTotal ?? 0,
                  })}
                </td>
                <td>{run.startedAt ?? run.queuedAt}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
