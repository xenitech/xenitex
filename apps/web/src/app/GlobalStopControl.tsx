import { useMutation } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { apiClient } from '../api/client.js';
import { unwrap } from '../api/error.js';
import { Button } from '../components/form/Button.js';
import { Field, TextArea } from '../components/form/Field.js';
import { Dialog } from '../components/primitives/Dialog.js';
import { Stack } from '../components/layout/Stack.js';
import { useSession } from '../auth/SessionContext.js';
import styles from './GlobalStopControl.module.css';

/**
 * SAFE-07: reachable from every screen (rendered once, in AppShell's
 * top bar) — halts all queued and running scan activity. Hidden (not just
 * disabled) for roles below operator: SEC-13 still enforces server-side,
 * this is purely P1-23 cosmetic gating so a viewer/analyst never sees a
 * control that would just 403.
 */
export function GlobalStopControl() {
  const { t } = useTranslation();
  const { hasCapability } = useSession();
  const [isOpen, setIsOpen] = useState(false);
  const [reason, setReason] = useState('');
  const titleId = useId();

  const mutation = useMutation({
    mutationFn: async () =>
      unwrap(await apiClient.POST('/global-stop', { body: reason ? { reason } : {} })),
    onSuccess: () => setIsOpen(false),
  });

  if (!hasCapability('scans.globalStop')) return null;

  return (
    <>
      <Button variant="danger" className={styles.trigger} onClick={() => setIsOpen(true)}>
        {t('common.globalStop')}
      </Button>
      <Dialog
        titleId={titleId}
        title={t('admin.globalStop.title')}
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
      >
        <Stack>
          <p>{t('admin.globalStop.description')}</p>
          <Field label={t('admin.globalStop.reason')}>
            <TextArea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} />
          </Field>
          {mutation.isSuccess && (
            <p role="status">
              {t('admin.globalStop.halted', { count: mutation.data.scanRunsHalted.length })}
            </p>
          )}
          <Stack className={styles.actions}>
            <Button
              variant="danger"
              onClick={() => mutation.mutate()}
              disabled={mutation.isPending}
            >
              {t('admin.globalStop.confirm')}
            </Button>
            <Button variant="secondary" onClick={() => setIsOpen(false)}>
              {t('common.cancel')}
            </Button>
          </Stack>
        </Stack>
      </Dialog>
    </>
  );
}
