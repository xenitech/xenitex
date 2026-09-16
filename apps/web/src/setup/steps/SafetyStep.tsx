import { useMutation } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { apiClient } from '../../api/client.js';
import { unwrap } from '../../api/error.js';
import { Button } from '../../components/form/Button.js';
import { Stack } from '../../components/layout/Stack.js';

/** B.1 — the acknowledgement gate SAFE-01..SAFE-08 require before any scan can run. */
export function SafetyStep({ onDone }: { readonly onDone: () => void }) {
  const { t } = useTranslation();
  const [acknowledged, setAcknowledged] = useState(false);
  const items = t('setup.safety.items', { returnObjects: true }) as readonly string[];

  const mutation = useMutation({
    mutationFn: async () => unwrap(await apiClient.POST('/setup/safety-acknowledgement')),
    onSuccess: onDone,
  });

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    mutation.mutate();
  };

  return (
    <form onSubmit={onSubmit}>
      <Stack>
        <p>{t('setup.safety.description')}</p>
        <ul>
          {items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
        <label>
          <input
            type="checkbox"
            checked={acknowledged}
            onChange={(e) => setAcknowledged(e.target.checked)}
          />{' '}
          {t('setup.safety.acknowledge')}
        </label>
        <Button type="submit" variant="primary" disabled={mutation.isPending || !acknowledged}>
          {t('common.next')}
        </Button>
      </Stack>
    </form>
  );
}
