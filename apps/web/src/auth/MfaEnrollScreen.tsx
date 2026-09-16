import { useMutation, useQuery } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { apiClient } from '../api/client.js';
import { ApiError, unwrap } from '../api/error.js';
import { Button } from '../components/form/Button.js';
import { ErrorState } from '../components/ErrorState/ErrorState.js';
import { Field, TextInput } from '../components/form/Field.js';
import { Stack } from '../components/layout/Stack.js';
import { useSession } from './SessionContext.js';
import styles from './AuthScreens.module.css';

/** SEC-09: mandatory TOTP enrolment for operator/administrator before the app is reachable. */
export function MfaEnrollScreen() {
  const { t } = useTranslation();
  const { invalidate } = useSession();
  const [code, setCode] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState<readonly string[] | undefined>(undefined);
  const [acknowledgedRecovery, setAcknowledgedRecovery] = useState(false);

  // /auth/mfa/enroll is a POST, but modelled as a query here (staleTime: Infinity)
  // so remounting this screen (e.g. a re-render from a parent state change)
  // doesn't silently generate a second, different provisioning secret.
  const enroll = useQuery({
    queryKey: ['auth', 'mfa', 'enroll'],
    queryFn: async () => unwrap(await apiClient.POST('/auth/mfa/enroll')),
    staleTime: Infinity,
  });

  const confirm = useMutation({
    mutationFn: async () => {
      if (!enroll.data) throw new Error('Enrollment not started');
      return unwrap(
        await apiClient.POST('/auth/mfa/enroll/confirm', {
          body: { enrollmentToken: enroll.data.enrollmentToken, code },
        }),
      );
    },
    onSuccess: (data) => setRecoveryCodes(data.recoveryCodes),
  });

  if (enroll.isLoading) return <div role="status">{t('common.loading')}</div>;
  if (enroll.isError) {
    const err = enroll.error instanceof ApiError ? enroll.error : undefined;
    return (
      <ErrorState
        title={t('components.errorState.title')}
        detail={err?.detail ?? ''}
        code={err?.code ?? 'unknown'}
        correlationId={err?.correlationId ?? 'unavailable'}
      />
    );
  }

  if (recoveryCodes) {
    return (
      <div className={styles.card}>
        <Stack>
          <h1 className={styles.title}>{t('auth.enroll.recoveryTitle')}</h1>
          <p>{t('auth.enroll.recoveryDescription')}</p>
          <div className={styles.recoveryCodes}>
            {recoveryCodes.map((rc) => (
              <span key={rc}>{rc}</span>
            ))}
          </div>
          <label>
            <input
              type="checkbox"
              checked={acknowledgedRecovery}
              onChange={(e) => setAcknowledgedRecovery(e.target.checked)}
            />{' '}
            {t('auth.enroll.recoveryAcknowledge')}
          </label>
          <Button
            variant="primary"
            disabled={!acknowledgedRecovery}
            onClick={() => void invalidate()}
          >
            {t('common.next')}
          </Button>
        </Stack>
      </div>
    );
  }

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    confirm.mutate();
  };

  return (
    <div className={styles.card}>
      <form onSubmit={onSubmit} noValidate>
        <Stack>
          <h1 className={styles.title}>{t('auth.enroll.title')}</h1>
          <p>{t('auth.enroll.description')}</p>
          <div className={styles.qr}>{enroll.data?.qrCodeUri}</div>
          <Field label={t('auth.enroll.secretLabel')}>
            <TextInput readOnly value={enroll.data?.secret ?? ''} />
          </Field>
          <Field
            label={t('auth.enroll.code')}
            error={confirm.error instanceof ApiError ? confirm.error.detail : undefined}
          >
            <TextInput
              value={code}
              onChange={(e) => setCode(e.target.value)}
              required
              inputMode="numeric"
              autoFocus
            />
          </Field>
          <Button type="submit" variant="primary" disabled={confirm.isPending}>
            {t('auth.enroll.submit')}
          </Button>
        </Stack>
      </form>
    </div>
  );
}
