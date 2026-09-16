import { useMutation } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { apiClient } from '../api/client.js';
import { ApiError, unwrap } from '../api/error.js';
import { Button } from '../components/form/Button.js';
import { Field, TextInput } from '../components/form/Field.js';
import { Stack } from '../components/layout/Stack.js';
import { useSession } from './SessionContext.js';
import styles from './AuthScreens.module.css';

/** P1-07/SEC-07: gates the app for an administrator-provisioned account until its owner sets their own password. */
export function ForcedPasswordChangeScreen() {
  const { t } = useTranslation();
  const { invalidate } = useSession();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const mismatch = confirmPassword.length > 0 && newPassword !== confirmPassword;

  const mutation = useMutation({
    mutationFn: async () =>
      unwrap(await apiClient.POST('/auth/password', { body: { currentPassword, newPassword } })),
    onSuccess: () => void invalidate(),
  });

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (mismatch) return;
    mutation.mutate();
  };

  return (
    <div className={styles.card}>
      <form onSubmit={onSubmit} noValidate>
        <Stack>
          <h1 className={styles.title}>{t('auth.forcedPasswordChange.title')}</h1>
          <p>{t('auth.forcedPasswordChange.description')}</p>
          <Field
            label={t('auth.forcedPasswordChange.current')}
            error={mutation.error instanceof ApiError ? mutation.error.detail : undefined}
          >
            <TextInput
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              required
              autoComplete="current-password"
              autoFocus
            />
          </Field>
          <Field label={t('auth.forcedPasswordChange.next')}>
            <TextInput
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
              minLength={12}
              autoComplete="new-password"
            />
          </Field>
          <Field
            label={t('auth.forcedPasswordChange.confirm')}
            error={mismatch ? t('auth.forcedPasswordChange.mismatch') : undefined}
          >
            <TextInput
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              autoComplete="new-password"
            />
          </Field>
          <Button type="submit" variant="primary" disabled={mutation.isPending}>
            {t('auth.forcedPasswordChange.submit')}
          </Button>
        </Stack>
      </form>
    </div>
  );
}
