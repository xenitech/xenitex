import { useTranslation } from 'react-i18next';
import { useSession } from '../../auth/SessionContext.js';
import { TextInput } from '../../components/form/Field.js';
import { useRetentionPoliciesQuery, useUpdateRetentionPolicyMutation } from '../useAdminQueries.js';
import styles from '../../components/layout/TabPanel.module.css';

export function RetentionTab() {
  const { t } = useTranslation();
  const { hasCapability } = useSession();
  const { data, isLoading } = useRetentionPoliciesQuery();
  const update = useUpdateRetentionPolicyMutation();
  const canWrite = hasCapability('retention.write');

  if (isLoading) return <p>{t('common.loading')}</p>;

  return (
    <div className={styles.list}>
      {data?.map((policy) => (
        <div key={policy.dataClass} className={styles.row}>
          <div className={styles.rowMain}>
            <strong>{policy.dataClass}</strong>
            <span className={styles.muted}>
              {t('admin.retention.floorHint', { days: policy.minimumFloorDays })}
            </span>
          </div>
          <TextInput
            type="number"
            min={policy.minimumFloorDays}
            defaultValue={policy.retentionDays}
            disabled={!canWrite}
            onBlur={(e) => {
              const value = Number(e.target.value);
              if (value >= policy.minimumFloorDays && value !== policy.retentionDays) {
                update.mutate({ dataClass: policy.dataClass, retentionDays: value });
              }
            }}
          />
        </div>
      ))}
    </div>
  );
}
