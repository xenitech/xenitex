import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { apiClient } from '../../api/client.js';
import { unwrap } from '../../api/error.js';
import { newIdempotencyKey } from '../../api/idempotency.js';
import { Button } from '../../components/form/Button.js';
import { Field, TextInput } from '../../components/form/Field.js';
import { Stack } from '../../components/layout/Stack.js';
import styles from './WizardSteps.module.css';

export function ScheduleStep({
  scopeId,
  profileId,
  onRunNow,
  onScheduled,
  onBack,
}: {
  readonly scopeId: string;
  readonly profileId: string;
  readonly onRunNow: () => void;
  readonly onScheduled: () => void;
  readonly onBack: () => void;
}) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<'now' | 'later'>('now');
  const [name, setName] = useState('');
  const [cronExpression, setCronExpression] = useState('0 2 * * 1');
  const [timezone] = useState(Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC');

  const createSchedule = useMutation({
    mutationFn: async () =>
      unwrap(
        await apiClient.POST('/scan-schedules', {
          params: { header: { 'Idempotency-Key': newIdempotencyKey() } },
          body: { name, scopeId, profileId, cronExpression, timezone, isEnabled: true },
        }),
      ),
    onSuccess: onScheduled,
  });

  return (
    <Stack>
      <p>{t('scans.wizard.schedule.description')}</p>
      <label className={styles.option} data-checked={mode === 'now'}>
        <input type="radio" checked={mode === 'now'} onChange={() => setMode('now')} />
        <strong>{t('scans.wizard.schedule.now')}</strong>
      </label>
      <label className={styles.option} data-checked={mode === 'later'}>
        <input type="radio" checked={mode === 'later'} onChange={() => setMode('later')} />
        <strong>{t('scans.wizard.schedule.later')}</strong>
      </label>
      {mode === 'later' && (
        <Stack>
          <Field label={t('scope.title')}>
            <TextInput value={name} onChange={(e) => setName(e.target.value)} required />
          </Field>
          <Field label="cron" hint="e.g. 0 2 * * 1 (02:00 every Monday)">
            <TextInput
              value={cronExpression}
              onChange={(e) => setCronExpression(e.target.value)}
              required
            />
          </Field>
        </Stack>
      )}
      <div className={styles.footer}>
        <Button variant="secondary" onClick={onBack}>
          {t('common.back')}
        </Button>
        {mode === 'now' ? (
          <Button variant="primary" onClick={onRunNow}>
            {t('common.next')}
          </Button>
        ) : (
          <Button
            variant="primary"
            disabled={!name || createSchedule.isPending}
            onClick={() => createSchedule.mutate()}
          >
            {t('common.save')}
          </Button>
        )}
      </div>
    </Stack>
  );
}
