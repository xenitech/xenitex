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

export function MfaChallengeScreen({ challengeToken }: { readonly challengeToken: string }) {
  const { t } = useTranslation();
  const { invalidate } = useSession();
  const [code, setCode] = useState('');
  const [useRecovery, setUseRecovery] = useState(false);

  const mutation = useMutation({
    mutationFn: async () =>
      unwrap(await apiClient.POST('/auth/mfa/challenge', { body: { challengeToken, code } })),
    onSuccess: () => void invalidate(),
  });

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    mutation.mutate();
  };

  return (
    <div className={styles.card}>
      <form onSubmit={onSubmit} noValidate>
        <Stack>
          <h1 className={styles.title}>{t('auth.mfa.title')}</h1>
          <p>{t('auth.mfa.description')}</p>
          <Field
            label={useRecovery ? t('auth.mfa.recoveryCode') : t('auth.mfa.code')}
            error={mutation.error instanceof ApiError ? t('auth.mfa.invalid') : undefined}
          >
            <TextInput
              value={code}
              onChange={(e) => setCode(e.target.value)}
              required
              inputMode={useRecovery ? 'text' : 'numeric'}
              autoFocus
            />
          </Field>
          <Button type="submit" variant="primary" disabled={mutation.isPending}>
            {t('auth.mfa.submit')}
          </Button>
          <Button type="button" variant="secondary" onClick={() => setUseRecovery((v) => !v)}>
            {t('auth.mfa.useRecovery')}
          </Button>
        </Stack>
      </form>
    </div>
  );
}
