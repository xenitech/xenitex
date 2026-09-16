import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/form/Button.js';
import { Field, TextInput } from '../../components/form/Field.js';
import { EmptyState } from '../../components/EmptyState/EmptyState.js';
import { useSession } from '../../auth/SessionContext.js';
import { useBlackoutWindowsQuery, useCreateBlackoutWindowMutation } from '../useScopeQueries.js';
import styles from '../../components/layout/TabPanel.module.css';

export function BlackoutsTab() {
  const { t } = useTranslation();
  const { hasCapability } = useSession();
  const { data, isLoading } = useBlackoutWindowsQuery();
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC';
  const create = useCreateBlackoutWindowMutation();

  if (isLoading) return <p>{t('common.loading')}</p>;

  return (
    <div>
      <div className={styles.header}>
        {hasCapability('scopes.write') && (
          <Button variant="primary" onClick={() => setShowForm((v) => !v)}>
            {t('scope.newBlackout')}
          </Button>
        )}
      </div>
      {!data?.length && <EmptyState title={t('scope.empty.blackouts')} description="" />}
      <div className={styles.list}>
        {data?.map((window_) => (
          <div key={window_.id} className={styles.row}>
            <div className={styles.rowMain}>
              <strong>{window_.name}</strong>
              <span className={styles.muted}>
                {window_.startsAt} → {window_.endsAt} ({window_.timezone})
              </span>
            </div>
            {window_.isRecurring && <span className={styles.muted}>↻</span>}
          </div>
        ))}
      </div>
      {showForm && (
        <div className={styles.form}>
          <Field label={t('setup.scope.name')}>
            <TextInput value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Starts">
            <TextInput
              type="datetime-local"
              value={startsAt}
              onChange={(e) => setStartsAt(e.target.value)}
            />
          </Field>
          <Field label="Ends">
            <TextInput
              type="datetime-local"
              value={endsAt}
              onChange={(e) => setEndsAt(e.target.value)}
            />
          </Field>
          <Button
            variant="primary"
            disabled={create.isPending || !name || !startsAt || !endsAt}
            onClick={() =>
              create.mutate(
                {
                  scopeId: null,
                  name,
                  timezone,
                  startsAt: new Date(startsAt).toISOString(),
                  endsAt: new Date(endsAt).toISOString(),
                  isRecurring: false,
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
