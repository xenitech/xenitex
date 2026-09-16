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

export function SignInScreen({
  onMfaRequired,
}: {
  readonly onMfaRequired: (challengeToken: string) => void;
}) {
  const { t } = useTranslation();
  const { invalidate } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const mutation = useMutation({
    mutationFn: async () =>
      unwrap(await apiClient.POST('/auth/login', { body: { email, password } })),
    onSuccess: (data) => {
      if ('mfaRequired' in data && data.mfaRequired) {
        onMfaRequired(data.challengeToken);
      } else {
        void invalidate();
      }
    },
  });

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    mutation.mutate();
  };

  const error = mutation.error;
  const errorMessage =
    error instanceof ApiError
      ? error.status === 423
        ? t('auth.signIn.lockedOut')
        : error.status === 429
          ? t('auth.signIn.rateLimited')
          : t('auth.signIn.invalid')
      : undefined;

  return (
    <div className={styles.card}>
      <form onSubmit={onSubmit} noValidate>
        <Stack>
          <h1 className={styles.title}>{t('auth.signIn.title')}</h1>
          <Field label={t('auth.signIn.email')} error={errorMessage}>
            <TextInput
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              autoFocus
            />
          </Field>
          <Field label={t('auth.signIn.password')}>
            <TextInput
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
            />
          </Field>
          <Button type="submit" variant="primary" disabled={mutation.isPending}>
            {t('auth.signIn.submit')}
          </Button>
        </Stack>
      </form>
    </div>
  );
}
