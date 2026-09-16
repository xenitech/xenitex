import { useMutation } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { apiClient } from '../../api/client.js';
import { ApiError, unwrap } from '../../api/error.js';
import { Button } from '../../components/form/Button.js';
import { Field, TextInput } from '../../components/form/Field.js';
import { Stack } from '../../components/layout/Stack.js';

export function AdministratorStep({ onDone }: { readonly onDone: () => void }) {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');

  const mutation = useMutation({
    mutationFn: async () =>
      unwrap(
        await apiClient.POST('/setup/administrator', { body: { email, displayName, password } }),
      ),
    onSuccess: onDone,
  });

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    mutation.mutate();
  };

  const fieldError =
    mutation.error instanceof ApiError
      ? (mutation.error.detail ?? mutation.error.message)
      : undefined;

  return (
    <form onSubmit={onSubmit} noValidate>
      <Stack>
        <p>{t('setup.administrator.description')}</p>
        <Field label={t('setup.administrator.displayName')}>
          <TextInput
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            required
            autoComplete="name"
          />
        </Field>
        <Field label={t('setup.administrator.email')} error={fieldError}>
          <TextInput
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
          />
        </Field>
        <Field
          label={t('setup.administrator.password')}
          hint={t('setup.administrator.passwordHint')}
        >
          <TextInput
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={12}
            autoComplete="new-password"
          />
        </Field>
        <Button type="submit" variant="primary" disabled={mutation.isPending}>
          {t('common.next')}
        </Button>
      </Stack>
    </form>
  );
}
