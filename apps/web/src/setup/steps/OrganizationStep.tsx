import { useMutation } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { apiClient } from '../../api/client.js';
import { unwrap } from '../../api/error.js';
import { Button } from '../../components/form/Button.js';
import { Field, Select, TextInput } from '../../components/form/Field.js';
import { Stack } from '../../components/layout/Stack.js';

// A representative, non-exhaustive set — the real implementation lists every IANA zone (Step 4); this is a Step 3 UI concern only.
const COMMON_TIMEZONES = [
  'UTC',
  'Europe/London',
  'Europe/Berlin',
  'Asia/Tehran',
  'Asia/Dubai',
  'Asia/Kolkata',
  'Asia/Singapore',
  'Australia/Sydney',
  'America/New_York',
  'America/Chicago',
  'America/Los_Angeles',
];

export function OrganizationStep({ onDone }: { readonly onDone: () => void }) {
  const { t } = useTranslation();
  const [organizationName, setOrganizationName] = useState('');
  const [timezone, setTimezone] = useState(
    Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC',
  );

  const mutation = useMutation({
    mutationFn: async () =>
      unwrap(await apiClient.POST('/setup/organization', { body: { organizationName, timezone } })),
    onSuccess: onDone,
  });

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    mutation.mutate();
  };

  return (
    <form onSubmit={onSubmit} noValidate>
      <Stack>
        <p>{t('setup.organization.description')}</p>
        <Field label={t('setup.organization.name')}>
          <TextInput
            value={organizationName}
            onChange={(e) => setOrganizationName(e.target.value)}
            required
          />
        </Field>
        <Field label={t('setup.organization.timezone')}>
          <Select value={timezone} onChange={(e) => setTimezone(e.target.value)}>
            {COMMON_TIMEZONES.map((tz) => (
              <option key={tz} value={tz}>
                {tz}
              </option>
            ))}
          </Select>
        </Field>
        <Button type="submit" variant="primary" disabled={mutation.isPending}>
          {t('common.next')}
        </Button>
      </Stack>
    </form>
  );
}
