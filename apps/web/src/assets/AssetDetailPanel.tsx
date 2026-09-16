import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { EmptyState } from '../components/EmptyState/EmptyState.js';
import { ErrorState } from '../components/ErrorState/ErrorState.js';
import { SkeletonRow } from '../components/SkeletonRow/SkeletonRow.js';
import { RiskBadge } from '../components/RiskBadge/RiskBadge.js';
import { StateChip } from '../components/StateChip/StateChip.js';
import { Stack } from '../components/layout/Stack.js';
import { ApiError } from '../api/error.js';
import {
  useAssetDetailQuery,
  useAssetIssuesQuery,
  useAssetScanHistoryQuery,
} from './useAssetsQueries.js';
import styles from './AssetDetailPanel.module.css';

type Tab = 'overview' | 'history' | 'issues' | 'scans';

export function AssetDetailPanel({ assetId }: { readonly assetId: string }) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>('overview');
  const { data, isLoading, isError, error } = useAssetDetailQuery(assetId);
  const issuesQuery = useAssetIssuesQuery(tab === 'issues' ? assetId : undefined);
  const scansQuery = useAssetScanHistoryQuery(tab === 'scans' ? assetId : undefined);

  if (isLoading) {
    return (
      <div className={styles.panel}>
        <SkeletonRow columnWidths={[1]} />
        <SkeletonRow columnWidths={[1]} />
      </div>
    );
  }

  if (isError || !data) {
    const apiErr = error instanceof ApiError ? error : undefined;
    return (
      <ErrorState
        title={t('components.errorState.title')}
        detail={apiErr?.detail ?? ''}
        code={apiErr?.code ?? 'unknown'}
        correlationId={apiErr?.correlationId ?? 'unavailable'}
      />
    );
  }

  const { data: asset } = data;
  const currentHostname = asset.hostnames.find((h) => h.isCurrent)?.hostnameUntrusted;

  return (
    <div className={styles.panel}>
      <h2 className={styles.title}>{currentHostname ?? asset.addresses[0]?.address ?? asset.id}</h2>
      {asset.isFragile && <p className={styles.fragileNotice}>{t('assets.detail.fragileHint')}</p>}
      <div className={styles.tabs} role="tablist">
        {(['overview', 'history', 'issues', 'scans'] as const).map((key) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            className={tab === key ? styles.tabActive : styles.tab}
            onClick={() => setTab(key)}
          >
            {t(`assets.detail.tabs.${key}`)}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <Stack className={styles.tabPanel}>
          <div>
            <h3 className={styles.sectionTitle}>{t('assets.columns.criticality')}</h3>
            <p>
              {t(`common.criticality.${asset.businessCriticality}`)} ·{' '}
              {t(`common.exposure.${asset.exposureClassification}`)}
            </p>
          </div>
          <div>
            <h3 className={styles.sectionTitle}>{t('assets.detail.identityKeys')}</h3>
            {asset.identityKeys.map((key, i) => (
              <p key={i} className={styles.muted}>
                {key.keyType}: {key.keyValueUntrusted} ({Math.round(key.confidence * 100)}%)
              </p>
            ))}
          </div>
          <div>
            <h3 className={styles.sectionTitle}>{t('assets.detail.services')}</h3>
            {asset.services.map((service, i) => (
              <p key={i} className={styles.muted}>
                {service.port}/{service.protocol} — {service.productUntrusted ?? '—'}{' '}
                {service.versionUntrusted ?? ''}
              </p>
            ))}
          </div>
          <div>
            <h3 className={styles.sectionTitle}>{t('assets.detail.tags')}</h3>
            <p className={styles.muted}>{asset.tags.join(', ') || '—'}</p>
          </div>
          <div>
            <h3 className={styles.sectionTitle}>{t('assets.detail.ownerTeam')}</h3>
            <p className={styles.muted}>{asset.ownerTeam ?? t('issues.detail.unassigned')}</p>
          </div>
        </Stack>
      )}

      {tab === 'history' && (
        <Stack className={styles.tabPanel}>
          <h3 className={styles.sectionTitle}>{t('assets.detail.addressHistory')}</h3>
          {asset.addresses.map((entry, i) => (
            <p key={i} className={styles.muted}>
              {entry.address} · {entry.firstSeen} → {entry.lastSeen}{' '}
              {entry.isCurrent && `(${t('common.current')})`}
            </p>
          ))}
          <h3 className={styles.sectionTitle}>{t('assets.detail.hostnameHistory')}</h3>
          {asset.hostnames.length === 0 && <p className={styles.muted}>—</p>}
          {asset.hostnames.map((entry, i) => (
            <p key={i} className={styles.muted}>
              {entry.hostnameUntrusted} · {entry.firstSeen} → {entry.lastSeen}
            </p>
          ))}
        </Stack>
      )}

      {tab === 'issues' && (
        <Stack className={styles.tabPanel}>
          {issuesQuery.data?.items.length === 0 && (
            <EmptyState title={t('assets.detail.tabs.issues')} description="" />
          )}
          {issuesQuery.data?.items.map((issue) => (
            <div key={issue.id} className={styles.issueRow}>
              <RiskBadge score={Math.round(issue.riskScore)} band={issue.severity} />
              <span>{issue.title}</span>
              <StateChip state={issue.state} />
            </div>
          ))}
        </Stack>
      )}

      {tab === 'scans' && (
        <Stack className={styles.tabPanel}>
          {scansQuery.data?.items.length === 0 && (
            <EmptyState title={t('assets.detail.tabs.scans')} description="" />
          )}
          {scansQuery.data?.items.map((run) => (
            <p key={run.id} className={styles.muted}>
              {run.id} — {run.status} — {run.queuedAt}
            </p>
          ))}
        </Stack>
      )}
    </div>
  );
}
