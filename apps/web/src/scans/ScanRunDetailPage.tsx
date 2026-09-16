import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { EmptyState } from '../components/EmptyState/EmptyState.js';
import { ErrorState } from '../components/ErrorState/ErrorState.js';
import { Button } from '../components/form/Button.js';
import { Dialog } from '../components/primitives/Dialog.js';
import { Stack } from '../components/layout/Stack.js';
import { ApiError } from '../api/error.js';
import { ScanStatusChip } from './ScanStatusChip.js';
import {
  useAbortScanRunMutation,
  usePauseScanRunMutation,
  useResumeScanRunMutation,
  useScanRunQuery,
  useScanRunRawArtifactsQuery,
  useScanRunTargetsQuery,
} from './useScansQueries.js';
import styles from './ScanRunDetailPage.module.css';

export function ScanRunDetailPage() {
  const { t } = useTranslation();
  const { scanRunId } = useParams<{ scanRunId: string }>();
  const [confirmAbort, setConfirmAbort] = useState(false);
  const runQuery = useScanRunQuery(scanRunId);
  const targetsQuery = useScanRunTargetsQuery(scanRunId);
  const artifactsQuery = useScanRunRawArtifactsQuery(scanRunId);
  const pause = usePauseScanRunMutation();
  const resume = useResumeScanRunMutation();
  const abort = useAbortScanRunMutation();

  if (runQuery.isLoading) return <p>{t('common.loading')}</p>;
  if (runQuery.isError || !runQuery.data) {
    const err = runQuery.error instanceof ApiError ? runQuery.error : undefined;
    return (
      <ErrorState
        title={t('components.errorState.title')}
        detail={err?.detail ?? ''}
        code={err?.code ?? 'unknown'}
        correlationId={err?.correlationId ?? 'unavailable'}
      />
    );
  }

  const run = runQuery.data;
  const targetsTotal = run.targetsTotal ?? 0;
  const targetsCompleted = run.targetsCompleted ?? 0;
  const progressPct = targetsTotal > 0 ? Math.round((targetsCompleted / targetsTotal) * 100) : 0;

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>{run.id}</h1>
          <ScanStatusChip status={run.status} />
        </div>
        <Stack className={styles.actions}>
          {run.status === 'running' && (
            <Button variant="secondary" onClick={() => pause.mutate({ scanRunId: run.id })}>
              {t('scans.run.pause')}
            </Button>
          )}
          {run.status === 'paused' && (
            <Button variant="secondary" onClick={() => resume.mutate({ scanRunId: run.id })}>
              {t('scans.run.resume')}
            </Button>
          )}
          {(run.status === 'queued' || run.status === 'running' || run.status === 'paused') && (
            <Button variant="danger" onClick={() => setConfirmAbort(true)}>
              {t('scans.run.abort')}
            </Button>
          )}
        </Stack>
      </div>

      <div className={styles.progressBar}>
        <div className={styles.progressFill} style={{ width: `${progressPct}%` }} />
      </div>
      <p className={styles.muted}>
        {t('scans.run.progress', { completed: targetsCompleted, total: targetsTotal })}
      </p>

      <h2 className={styles.sectionTitle}>{t('scans.run.targets')}</h2>
      {targetsQuery.data?.items.length === 0 && (
        <EmptyState title={t('scans.run.targets')} description={t('scans.run.noTargetsYet')} />
      )}
      <table className={styles.table}>
        <tbody>
          {targetsQuery.data?.items.map((target) => (
            <tr key={target.id}>
              <td>{target.targetAddress}</td>
              <td>{target.status}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2 className={styles.sectionTitle}>{t('scans.run.downloadRawArtifacts')}</h2>
      {artifactsQuery.data?.length === 0 && <p className={styles.muted}>—</p>}
      {artifactsQuery.data?.map((artifact) => (
        <p key={artifact.id}>
          <a href={`/v1/raw-artifacts/${artifact.id}/download`}>
            {artifact.scannerAdapterKey} · {artifact.contentType} ·{' '}
            {artifact.sizeBytes.toLocaleString()} bytes
          </a>
        </p>
      ))}

      <Dialog
        titleId="abort-scan-title"
        title={t('scans.run.abort')}
        isOpen={confirmAbort}
        onClose={() => setConfirmAbort(false)}
      >
        <Stack>
          <p>{t('scans.run.abortConfirm')}</p>
          <Stack className={styles.actions}>
            <Button
              variant="danger"
              onClick={() =>
                abort.mutate({ scanRunId: run.id }, { onSuccess: () => setConfirmAbort(false) })
              }
            >
              {t('scans.run.abort')}
            </Button>
            <Button variant="secondary" onClick={() => setConfirmAbort(false)}>
              {t('common.cancel')}
            </Button>
          </Stack>
        </Stack>
      </Dialog>
    </div>
  );
}
