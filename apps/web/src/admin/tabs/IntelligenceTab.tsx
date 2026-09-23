import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/form/Button.js';
import { Field, TextInput } from '../../components/form/Field.js';
import { useSession } from '../../auth/SessionContext.js';
import { flattenPages } from '../../api/pagination.js';
import {
  useCreateIntelSyncMutation,
  useIntelImportsQuery,
  useIntelStatusQuery,
  useSetIntelOnlineUpdatesDisabledMutation,
} from '../useIntelQueries.js';
import styles from '../../components/layout/TabPanel.module.css';

type FailureReasonKey = 'no_connectivity' | 'online_updates_disabled';

/**
 * docs/cve-intel-feature-spec.md UI-103/104/106. UI-105 (CPE-family
 * allowlist + threshold editor with live retained-count preview) and
 * UI-107/108 (per-source JobProgress, the "newly known-exploited" notice)
 * are not built yet — the sync itself only fetches NVD+EPSS today (no
 * family filtering, no live per-page progress), so a UI that promised those
 * would be showing controls with nothing real behind them.
 */
export function IntelligenceTab() {
  const { t } = useTranslation();
  const { hasCapability } = useSession();
  const status = useIntelStatusQuery();
  const importsQuery = useIntelImportsQuery();
  const imports = useMemo(() => flattenPages(importsQuery.data?.pages), [importsQuery.data]);
  const sync = useCreateIntelSyncMutation();
  const setDisabled = useSetIntelOnlineUpdatesDisabledMutation();
  const [modifiedSinceDays, setModifiedSinceDays] = useState(7);

  if (status.isLoading) return <p>{t('common.loading')}</p>;
  const data = status.data;

  return (
    <div>
      <div className={styles.header}>
        {hasCapability('scopes.write') && !data?.onlineUpdatesDisabled && (
          <>
            <Field label="Modified within (days)">
              <TextInput
                type="number"
                min={1}
                max={120}
                value={modifiedSinceDays}
                onChange={(e) => setModifiedSinceDays(Number(e.target.value))}
              />
            </Field>
            <Button
              variant="primary"
              disabled={sync.isPending || data?.lastSyncAttempt?.status === 'validating'}
              onClick={() => sync.mutate({ modifiedSinceDays })}
            >
              {t('admin.intel.updateNow')}
            </Button>
          </>
        )}
      </div>

      {data?.onlineUpdatesDisabled && (
        <div className={styles.row}>
          <span>{t('admin.intel.onlineUpdatesDisabled')}</span>
        </div>
      )}

      <div className={styles.list}>
        <div className={styles.row}>
          <div className={styles.rowMain}>
            <strong>{t('admin.intel.activeCorpus')}</strong>
            <span className={styles.muted}>
              {data?.activeCorpusImport
                ? `${data.activeCorpusImport.sourceName} · ${data.activeCorpusImport.sourceVersion} · ${new Date(data.activeCorpusImport.importedAt).toLocaleString()}`
                : t('admin.intel.noCorpusYet')}
            </span>
          </div>
        </div>
        <div className={styles.row}>
          <div className={styles.rowMain}>
            <strong>{t('admin.intel.totalVulnerabilities')}</strong>
            <span className={styles.muted}>{data?.totalVulnerabilities ?? 0}</span>
          </div>
        </div>
        <div className={styles.row}>
          <div className={styles.rowMain}>
            <strong>{t('admin.intel.knownExploited')}</strong>
            <span className={styles.muted}>{data?.knownExploitedCount ?? 0}</span>
          </div>
        </div>
        <div className={styles.row}>
          <div className={styles.rowMain}>
            <strong>{t('admin.intel.lastSync')}</strong>
            <span className={styles.muted}>
              {data?.lastSyncAttempt
                ? data.lastSyncAttempt.status === 'validating'
                  ? t('admin.intel.syncing')
                  : `${t(`admin.intel.status.${data.lastSyncAttempt.status as 'applied' | 'failed' | 'superseded'}`)} · ${new Date(data.lastSyncAttempt.importedAt).toLocaleString()}${data.lastSyncAttempt.failureReason ? ` — ${t(`admin.intel.failureReason.${data.lastSyncAttempt.failureReason as FailureReasonKey}`, { defaultValue: data.lastSyncAttempt.failureReason })}` : ''}`
                : t('admin.intel.neverSynced')}
            </span>
          </div>
        </div>
      </div>

      {hasCapability('scopes.write') && (
        <div className={styles.header}>
          <Button
            variant={data?.onlineUpdatesDisabled ? 'primary' : 'danger'}
            disabled={setDisabled.isPending}
            onClick={() => setDisabled.mutate(!data?.onlineUpdatesDisabled)}
          >
            {data?.onlineUpdatesDisabled
              ? t('admin.intel.enableOnlineUpdates')
              : t('admin.intel.disableOnlineUpdates')}
          </Button>
        </div>
      )}

      <h2>{t('admin.intel.history')}</h2>
      <div className={styles.list}>
        {imports.map((imp) => (
          <div key={imp.id} className={styles.row}>
            <div className={styles.rowMain}>
              <strong>
                {imp.sourceName} · {imp.sourceVersion}
              </strong>
              <span className={styles.muted}>
                {new Date(imp.importedAt).toLocaleString()} ·{' '}
                {t(
                  `admin.intel.status.${imp.status as 'validating' | 'applied' | 'failed' | 'superseded'}`,
                )}
                {imp.status === 'applied' &&
                  ` · +${imp.added ?? 0} / ~${imp.modified ?? 0} / ⌀${imp.discarded ?? 0}`}
                {imp.failureReason &&
                  ` — ${t(`admin.intel.failureReason.${imp.failureReason as FailureReasonKey}`, { defaultValue: imp.failureReason })}`}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
