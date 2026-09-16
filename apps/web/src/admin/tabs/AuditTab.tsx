import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/form/Button.js';
import { flattenPages } from '../../api/pagination.js';
import { useAuditEntriesQuery, useVerifyAuditChainQuery } from '../useAdminQueries.js';
import styles from '../../components/layout/TabPanel.module.css';
import chainStyles from './AuditTab.module.css';

export function AuditTab() {
  const { t } = useTranslation();
  const query = useAuditEntriesQuery();
  const entries = useMemo(() => flattenPages(query.data?.pages), [query.data]);
  const verify = useVerifyAuditChainQuery();

  return (
    <div>
      <div className={styles.header}>
        <Button variant="secondary" disabled={verify.isFetching} onClick={() => verify.refetch()}>
          {t('admin.audit.verify')}
        </Button>
        {verify.data && (
          <span className={verify.data.isIntact ? chainStyles.intact : chainStyles.broken}>
            {verify.data.isIntact ? t('admin.audit.chainIntact') : t('admin.audit.chainBroken')}
          </span>
        )}
      </div>
      <table className={styles.list}>
        <tbody>
          {entries.map((entry) => (
            <tr key={entry.id} className={styles.row}>
              <td>{entry.occurredAt}</td>
              <td>{entry.actorUserId ?? 'system'}</td>
              <td>{entry.action}</td>
              <td>
                {entry.targetType}/{entry.targetId}
              </td>
              <td>{entry.outcome}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
