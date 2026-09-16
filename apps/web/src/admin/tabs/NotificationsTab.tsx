import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/form/Button.js';
import { Field, Select, TextInput } from '../../components/form/Field.js';
import { EmptyState } from '../../components/EmptyState/EmptyState.js';
import { useSession } from '../../auth/SessionContext.js';
import type { NotificationChannelType } from '../../api/types.js';
import {
  useCreateNotificationChannelMutation,
  useNotificationChannelsQuery,
} from '../useAdminQueries.js';
import styles from '../../components/layout/TabPanel.module.css';

export function NotificationsTab() {
  const { t } = useTranslation();
  const { hasCapability } = useSession();
  const { data, isLoading } = useNotificationChannelsQuery();
  const [showForm, setShowForm] = useState(false);
  const [type, setType] = useState<NotificationChannelType>('email');
  const [address, setAddress] = useState('');
  const create = useCreateNotificationChannelMutation();
  const canWrite = hasCapability('notifications.write');

  if (isLoading) return <p>{t('common.loading')}</p>;

  return (
    <div>
      <div className={styles.header}>
        {canWrite && (
          <Button variant="primary" onClick={() => setShowForm((v) => !v)}>
            +
          </Button>
        )}
      </div>
      {!data?.length && <EmptyState title={t('admin.tabs.notifications')} description="" />}
      <div className={styles.list}>
        {data?.map((channel) => (
          <div key={channel.id} className={styles.row}>
            <div className={styles.rowMain}>
              <strong>{channel.type}</strong>
              <span className={styles.muted}>{JSON.stringify(channel.config)}</span>
            </div>
            <span className={styles.muted}>{channel.isEnabled ? 'enabled' : 'disabled'}</span>
          </div>
        ))}
      </div>
      {showForm && (
        <div className={styles.form}>
          <Field label={t('admin.tabs.notifications')}>
            <Select
              value={type}
              onChange={(e) => setType(e.target.value as NotificationChannelType)}
            >
              <option value="email">email</option>
              <option value="webhook">webhook</option>
            </Select>
          </Field>
          <Field label={type === 'email' ? 'address' : 'URL'}>
            <TextInput value={address} onChange={(e) => setAddress(e.target.value)} />
          </Field>
          <Button
            variant="primary"
            disabled={create.isPending || !address}
            onClick={() =>
              create.mutate(
                {
                  type,
                  config: type === 'email' ? { address } : { url: address },
                  isEnabled: true,
                },
                { onSuccess: () => setShowForm(false) },
              )
            }
          >
            {t('common.save')}
          </Button>
        </div>
      )}
    </div>
  );
}
