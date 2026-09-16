import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/form/Button.js';
import { useSession } from '../../auth/SessionContext.js';
import { flattenPages } from '../../api/pagination.js';
import { useBackupRecordsQuery, useCreateBackupMutation } from '../useAdminQueries.js';
import styles from '../../components/layout/TabPanel.module.css';

export function BackupTab() {
  const { t } = useTranslation();
  const { hasCapability } = useSession();
  const query = useBackupRecordsQuery();
  const records = useMemo(() => flattenPages(query.data?.pages), [query.data]);
  const createBackup = useCreateBackupMutation();

  return (
    <div>
      <div className={styles.header}>
        {hasCapability('retention.write') && (
          <Button
            variant="primary"
            disabled={createBackup.isPending}
            onClick={() => createBackup.mutate()}
          >
            {t('admin.backup.triggerBackup')}
          </Button>
        )}
      </div>
      <div className={styles.list}>
        {records.map((backup) => (
          <div key={backup.id} className={styles.row}>
            <div className={styles.rowMain}>
              <strong>{backup.startedAt}</strong>
              <span className={styles.muted}>
                {backup.status} · {backup.encrypted ? 'encrypted' : 'unencrypted'} ·{' '}
                {backup.sizeBytes ? `${(backup.sizeBytes / 1_000_000).toFixed(0)} MB` : ''}
              </span>
            </div>
            <span className={styles.muted}>
              {backup.restoreTestedAt
                ? `${t('admin.backup.restoreTested')}: ${backup.restoreTestedAt}`
                : ''}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
