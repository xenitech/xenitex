import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import { EmptyState } from '../components/EmptyState/EmptyState.js';
import { ErrorState } from '../components/ErrorState/ErrorState.js';
import { RiskBadge } from '../components/RiskBadge/RiskBadge.js';
import { ScanStatusChip } from '../scans/ScanStatusChip.js';
import { ApiError } from '../api/error.js';
import { Sparkline } from './Sparkline.js';
import { useDashboardQuery } from './useDashboardQuery.js';
import styles from './DashboardPage.module.css';

const RISK_BAND_ORDER = ['critical', 'high', 'medium', 'low', 'info'] as const;

export function DashboardPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { data, isLoading, isError, error } = useDashboardQuery();

  if (isLoading) return <p>{t('common.loading')}</p>;

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

  const isEmpty = data.coverage.assetsTotal === 0;
  if (isEmpty) {
    return (
      <div className={styles.page}>
        <h1 className={styles.title}>{t('dashboard.title')}</h1>
        <EmptyState
          title={t('dashboard.empty.title')}
          description={t('dashboard.empty.description')}
          action={{ label: t('dashboard.empty.action'), onClick: () => navigate('/scope') }}
        />
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>{t('dashboard.title')}</h1>
      <div className={styles.grid}>
        <Link to="/issues" className={styles.tile}>
          <h2 className={styles.tileTitle}>{t('dashboard.tiles.riskPosture')}</h2>
          <div className={styles.riskBands}>
            {RISK_BAND_ORDER.map((band) => (
              <div key={band} className={styles.riskBandRow}>
                <span className={styles.riskBandLabel}>{t(`components.riskBadge.${band}`)}</span>
                <strong>{data.riskPosture.openIssuesByRiskBand?.[band] ?? 0}</strong>
              </div>
            ))}
          </div>
          {data.trend && data.trend.length > 1 && (
            <Sparkline points={data.trend.map((d) => ({ date: d.date, value: d.openIssues }))} />
          )}
        </Link>

        <Link to="/issues?sort=riskScore" className={styles.tile}>
          <h2 className={styles.tileTitle}>{t('dashboard.tiles.topIssues')}</h2>
          <div className={styles.topIssues}>
            {data.topIssues.slice(0, 5).map((issue) => (
              <div key={issue.id} className={styles.topIssueRow}>
                <RiskBadge score={Math.round(issue.riskScore)} band={issue.severity} />
                <span className={styles.topIssueTitle}>{issue.title}</span>
              </div>
            ))}
          </div>
        </Link>

        <Link to="/issues?overdue=true" className={styles.tile}>
          <h2 className={styles.tileTitle}>{t('dashboard.tiles.sla')}</h2>
          <div className={styles.slaRow}>
            <div>
              <strong className={styles.slaOverdue}>{data.slaCompliance.overdue}</strong>
              <span>{t('dashboard.sla.overdue')}</span>
            </div>
            <div>
              <strong>{data.slaCompliance.approachingDue}</strong>
              <span>{t('dashboard.sla.approachingDue')}</span>
            </div>
            <div>
              <strong>{data.slaCompliance.onTrack}</strong>
              <span>{t('dashboard.sla.onTrack')}</span>
            </div>
          </div>
        </Link>

        <Link to="/assets" className={styles.tile}>
          <h2 className={styles.tileTitle}>{t('dashboard.tiles.coverage')}</h2>
          <p>
            {t('dashboard.coverage.scanned', {
              scanned: data.coverage.assetsScannedLast30Days,
              total: data.coverage.assetsTotal,
            })}
          </p>
        </Link>

        <Link to="/scans" className={styles.tile}>
          <h2 className={styles.tileTitle}>{t('dashboard.tiles.activeScans')}</h2>
          <div className={styles.activeScans}>
            {data.activeScans.length === 0 && <span className={styles.muted}>—</span>}
            {data.activeScans.slice(0, 5).map((run) => (
              <div key={run.id} className={styles.activeScanRow}>
                <span>{run.id}</span>
                <ScanStatusChip status={run.status} />
              </div>
            ))}
          </div>
        </Link>

        <Link to="/exceptions?status=approved" className={styles.tile}>
          <h2 className={styles.tileTitle}>{t('dashboard.tiles.exceptionsExpiring')}</h2>
          {data.exceptionsApproachingExpiry?.length ? (
            <div className={styles.activeScans}>
              {data.exceptionsApproachingExpiry.slice(0, 5).map((exception) => (
                <div key={exception.id} className={styles.activeScanRow}>
                  <span>{exception.issueId}</span>
                  <span className={styles.muted}>
                    {t('exceptions.expiresIn', {
                      count: Math.max(
                        0,
                        Math.ceil(
                          (new Date(exception.expiresAt).getTime() - Date.now()) / 86_400_000,
                        ),
                      ),
                    })}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <span className={styles.muted}>—</span>
          )}
        </Link>
      </div>
    </div>
  );
}
