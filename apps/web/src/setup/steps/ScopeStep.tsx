import { useMutation } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { apiClient } from '../../api/client.js';
import { unwrap } from '../../api/error.js';
import { Button } from '../../components/form/Button.js';
import { Field, Select, TextArea, TextInput } from '../../components/form/Field.js';
import { Stack } from '../../components/layout/Stack.js';

type AttestationType =
  'self_attested_owner' | 'delegated_authority' | 'contract_engagement' | 'other';
const ATTESTATION_TYPES: readonly AttestationType[] = [
  'self_attested_owner',
  'delegated_authority',
  'contract_engagement',
  'other',
];

function linesOf(value: string): string[] {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

/** SAFE-01: the first scope declaration — same shape the standalone Scope screen (3.6) reuses for every subsequent one. */
export function ScopeStep({ onDone }: { readonly onDone: () => void }) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [cidrRanges, setCidrRanges] = useState('');
  const [hostnames, setHostnames] = useState('');
  const [attestationType, setAttestationType] = useState<AttestationType>('self_attested_owner');
  const [attestationDetails, setAttestationDetails] = useState('');

  const mutation = useMutation({
    mutationFn: async () =>
      unwrap(
        await apiClient.POST('/setup/initial-scope', {
          body: {
            name,
            cidrRanges: linesOf(cidrRanges),
            hostnames: linesOf(hostnames),
            attestationType,
            attestationDetails,
          },
        }),
      ),
    onSuccess: onDone,
  });

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    mutation.mutate();
  };

  const noTargets = linesOf(cidrRanges).length === 0 && linesOf(hostnames).length === 0;

  return (
    <form onSubmit={onSubmit} noValidate>
      <Stack>
        <p>{t('setup.scope.description')}</p>
        <Field label={t('setup.scope.name')}>
          <TextInput value={name} onChange={(e) => setName(e.target.value)} required />
        </Field>
        <Field label={t('setup.scope.cidrRanges')}>
          <TextArea
            value={cidrRanges}
            onChange={(e) => setCidrRanges(e.target.value)}
            rows={3}
            placeholder="10.0.0.0/24"
          />
        </Field>
        <Field label={t('setup.scope.hostnames')}>
          <TextArea
            value={hostnames}
            onChange={(e) => setHostnames(e.target.value)}
            rows={3}
            placeholder="app.internal.example"
          />
        </Field>
        <Field label={t('setup.scope.attestationType')}>
          <Select
            value={attestationType}
            onChange={(e) => setAttestationType(e.target.value as AttestationType)}
          >
            {ATTESTATION_TYPES.map((type) => (
              <option key={type} value={type}>
                {t(`setup.scope.attestationTypes.${type}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('setup.scope.attestationDetails')}>
          <TextArea
            value={attestationDetails}
            onChange={(e) => setAttestationDetails(e.target.value)}
            rows={2}
            required
          />
        </Field>
        <Button
          type="submit"
          variant="primary"
          disabled={mutation.isPending || noTargets || !attestationDetails}
        >
          {t('common.next')}
        </Button>
      </Stack>
    </form>
  );
}
