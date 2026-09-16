import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/form/Button.js';
import { Field, Select, TextInput } from '../../components/form/Field.js';
import { useSession } from '../../auth/SessionContext.js';
import { flattenPages } from '../../api/pagination.js';
import type { UserRole } from '../../api/types.js';
import {
  useCreateUserMutation,
  useDeactivateUserMutation,
  useUsersQuery,
} from '../useAdminQueries.js';
import styles from '../../components/layout/TabPanel.module.css';

const ROLES: readonly UserRole[] = ['viewer', 'analyst', 'operator', 'administrator'];

export function UsersTab() {
  const { t } = useTranslation();
  const { hasCapability } = useSession();
  const query = useUsersQuery();
  const users = useMemo(() => flattenPages(query.data?.pages), [query.data]);
  const [showForm, setShowForm] = useState(false);
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [role, setRole] = useState<UserRole>('viewer');
  const [password, setPassword] = useState('');
  const create = useCreateUserMutation();
  const deactivate = useDeactivateUserMutation();
  const canWrite = hasCapability('users.write');

  return (
    <div>
      <div className={styles.header}>
        {canWrite && (
          <Button variant="primary" onClick={() => setShowForm((v) => !v)}>
            {t('admin.users.invite')}
          </Button>
        )}
      </div>
      <div className={styles.list}>
        {users.map((user) => (
          <div key={user.id} className={styles.row}>
            <div className={styles.rowMain}>
              <strong>{user.displayName}</strong>
              <span className={styles.muted}>
                {user.email} · {t(`common.roles.${user.role}`)} ·{' '}
                {user.mfaEnabled ? t('admin.users.mfaEnabled') : ''}
              </span>
            </div>
            <div>
              <span className={styles.muted}>
                {user.isActive ? t('admin.users.active') : t('admin.users.inactive')}
              </span>
              {canWrite && user.isActive && (
                <Button variant="danger" onClick={() => deactivate.mutate(user.id)}>
                  {t('admin.users.deactivate')}
                </Button>
              )}
            </div>
          </div>
        ))}
      </div>
      {showForm && (
        <div className={styles.form}>
          <Field label={t('setup.administrator.displayName')}>
            <TextInput value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
          </Field>
          <Field label={t('setup.administrator.email')}>
            <TextInput type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label={t('admin.users.role')}>
            <Select value={role} onChange={(e) => setRole(e.target.value as UserRole)}>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {t(`common.roles.${r}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label={t('setup.administrator.password')}
            hint={t('setup.administrator.passwordHint')}
          >
            <TextInput
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={12}
            />
          </Field>
          <Button
            variant="primary"
            disabled={create.isPending || !email || !displayName || password.length < 12}
            onClick={() =>
              create.mutate(
                { email, displayName, role, password },
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
