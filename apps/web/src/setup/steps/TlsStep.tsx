import { useMutation } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { apiClient } from '../../api/client.js';
import { unwrap } from '../../api/error.js';
import { Button } from '../../components/form/Button.js';
import { Stack } from '../../components/layout/Stack.js';
import styles from './TlsStep.module.css';

type TlsMode = 'self_signed' | 'customer_certificate';

export function TlsStep({ onDone }: { readonly onDone: () => void }) {
  const { t } = useTranslation();
  const [tlsMode, setTlsMode] = useState<TlsMode>('self_signed');

  const mutation = useMutation({
    mutationFn: async () => unwrap(await apiClient.POST('/setup/tls', { body: { tlsMode } })),
    onSuccess: onDone,
  });

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    mutation.mutate();
  };

  return (
    <form onSubmit={onSubmit}>
      <Stack>
        <p>{t('setup.tls.description')}</p>
        <label className={styles.option} data-checked={tlsMode === 'self_signed'}>
          <input
            type="radio"
            name="tlsMode"
            checked={tlsMode === 'self_signed'}
            onChange={() => setTlsMode('self_signed')}
          />
          <span>
            <strong>{t('setup.tls.selfSigned')}</strong>
            <p>{t('setup.tls.selfSignedHint')}</p>
          </span>
        </label>
        <label className={styles.option} data-checked={tlsMode === 'customer_certificate'}>
          <input
            type="radio"
            name="tlsMode"
            checked={tlsMode === 'customer_certificate'}
            onChange={() => setTlsMode('customer_certificate')}
          />
          <span>
            <strong>{t('setup.tls.customerCertificate')}</strong>
            <p>{t('setup.tls.customerCertificateHint')}</p>
          </span>
        </label>
        <Button type="submit" variant="primary" disabled={mutation.isPending}>
          {t('common.next')}
        </Button>
      </Stack>
    </form>
  );
}
