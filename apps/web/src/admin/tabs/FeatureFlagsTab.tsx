import { useTranslation } from 'react-i18next';
import { useSession } from '../../auth/SessionContext.js';
import { ApiError } from '../../api/error.js';
import { useFeatureFlagsQuery, useUpdateFeatureFlagMutation } from '../useAdminQueries.js';
import styles from '../../components/layout/TabPanel.module.css';

export function FeatureFlagsTab() {
  const { t } = useTranslation();
  const { hasCapability } = useSession();
  const { data, isLoading } = useFeatureFlagsQuery();
  const update = useUpdateFeatureFlagMutation();
  const canWrite = hasCapability('featureFlags.write');

  if (isLoading) return <p>{t('common.loading')}</p>;

  return (
    <div className={styles.list}>
      {data?.map((flag) => (
        <label key={flag.key} className={styles.row}>
          <div className={styles.rowMain}>
            <strong>{flag.key}</strong>
            <span className={styles.muted}>{flag.description}</span>
            {update.isError &&
              update.variables?.key === flag.key &&
              update.error instanceof ApiError && (
                <span className={styles.muted}>{update.error.detail}</span>
              )}
          </div>
          <input
            type="checkbox"
            checked={flag.isEnabled}
            disabled={!canWrite}
            onChange={(e) => update.mutate({ key: flag.key, isEnabled: e.target.checked })}
          />
        </label>
      ))}
    </div>
  );
}
