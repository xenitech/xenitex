import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router-dom';
import { EmptyState } from '../components/EmptyState/EmptyState.js';
import { ErrorState } from '../components/ErrorState/ErrorState.js';
import { Button } from '../components/form/Button.js';
import { Select } from '../components/form/Field.js';
import { ApiError } from '../api/error.js';
import { flattenPages } from '../api/pagination.js';
import { useSession } from '../auth/SessionContext.js';
import type { Exception } from '../api/types.js';
import {
  useApproveExceptionMutation,
  useExceptionsQuery,
  useRejectExceptionMutation,
  useRevokeExceptionMutation,
} from './useExceptionQueries.js';
import styles from './ExceptionsPage.module.css';

const STATUSES: readonly Exception['status'][] = [
  'pending',
  'approved',
  'rejected',
  'expired',
  'revoked',
];

function daysUntil(iso: string): number {
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000);
}

export function ExceptionsPage() {
  const { t } = useTranslation();
  const { hasCapability } = useSession();
  const [searchParams, setSearchParams] = useSearchParams();
  const status = (searchParams.get('status') as Exception['status'] | null) ?? undefined;
  const query = useExceptionsQuery(status);
  const exceptions = useMemo(() => flattenPages(query.data?.pages), [query.data]);
  const approve = useApproveExceptionMutation();
  const reject = useRejectExceptionMutation();
  const revoke = useRevokeExceptionMutation();
  const canApprove = hasCapability('exceptions.approve');

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
        <h1 className={styles.title}>{t('exceptions.title')}</h1>
        <Select
          value={status ?? ''}
          onChange={(e) =>
            setSearchParams(
              (prev) => {
                const params = new URLSearchParams(prev);
                if (e.target.value) params.set('status', e.target.value);
                else params.delete('status');
                return params;
              },
              { replace: true },
            )
          }
        >
          <option value="">{t('common.filters')}</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Select>
      </div>
      {!query.isLoading && exceptions.length === 0 ? (
        <EmptyState
          title={t('exceptions.empty.title')}
          description={t('exceptions.empty.description')}
        />
      ) : (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>{t('exceptions.columns.issue')}</th>
              <th>{t('exceptions.columns.requestedBy')}</th>
              <th>{t('exceptions.columns.status')}</th>
              <th>{t('exceptions.columns.expires')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {exceptions.map((exception) => {
              const days = daysUntil(exception.expiresAt);
              return (
                <tr key={exception.id}>
                  <td>
                    <Link to={`/issues?selected=${exception.issueId}`}>{exception.issueId}</Link>
                  </td>
                  <td>{exception.requestedBy}</td>
                  <td>{exception.status}</td>
                  <td>
                    {days >= 0
                      ? t('exceptions.expiresIn', { count: days })
                      : t('exceptions.expired')}
                  </td>
                  <td className={styles.actions}>
                    {canApprove && exception.status === 'pending' && (
                      <>
                        <Button variant="primary" onClick={() => approve.mutate(exception.id)}>
                          {t('exceptions.approve')}
                        </Button>
                        <Button variant="secondary" onClick={() => reject.mutate(exception.id)}>
                          {t('exceptions.reject')}
                        </Button>
                      </>
                    )}
                    {canApprove && exception.status === 'approved' && (
                      <Button variant="danger" onClick={() => revoke.mutate(exception.id)}>
                        {t('exceptions.revoke')}
                      </Button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
