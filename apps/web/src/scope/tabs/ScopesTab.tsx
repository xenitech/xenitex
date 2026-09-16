import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/form/Button.js';
import { Field, Select, TextArea, TextInput } from '../../components/form/Field.js';
import { EmptyState } from '../../components/EmptyState/EmptyState.js';
import { useSession } from '../../auth/SessionContext.js';
import {
  useAuthorizedScopesQuery,
  useCreateAuthorizedScopeMutation,
  useSupersedeAuthorizedScopeMutation,
} from '../useScopeQueries.js';
import type { AttestationType } from '../../api/types.js';
import styles from '../../components/layout/TabPanel.module.css';

const ATTESTATION_TYPES: readonly AttestationType[] = [
  'self_attested_owner',
  'delegated_authority',
  'contract_engagement',
  'other',
];

function linesOf(value: string): string[] {
  return value
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
}

interface ScopeFormState {
  readonly name: string;
  readonly cidrRanges: string;
  readonly hostnames: string;
  readonly attestationType: AttestationType;
  readonly attestationDetails: string;
}

const EMPTY_FORM: ScopeFormState = {
  name: '',
  cidrRanges: '',
  hostnames: '',
  attestationType: 'self_attested_owner',
  attestationDetails: '',
};

function ScopeForm({
  initial,
  pending,
  onSave,
  onCancel,
}: {
  readonly initial: ScopeFormState;
  readonly pending: boolean;
  readonly onSave: (state: ScopeFormState) => void;
  readonly onCancel: (() => void) | null;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState(initial.name);
  const [cidrRanges, setCidrRanges] = useState(initial.cidrRanges);
  const [hostnames, setHostnames] = useState(initial.hostnames);
  const [attestationType, setAttestationType] = useState(initial.attestationType);
  const [attestationDetails, setAttestationDetails] = useState(initial.attestationDetails);

  return (
    <div className={styles.form}>
      <Field label={t('setup.scope.name')}>
        <TextInput value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label={t('setup.scope.cidrRanges')}>
        <TextArea value={cidrRanges} onChange={(e) => setCidrRanges(e.target.value)} rows={2} />
      </Field>
      <Field label={t('setup.scope.hostnames')}>
        <TextArea value={hostnames} onChange={(e) => setHostnames(e.target.value)} rows={2} />
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
        />
      </Field>
      <div className={styles.header}>
        <Button
          variant="primary"
          disabled={pending || !name || !attestationDetails}
          onClick={() =>
            onSave({ name, cidrRanges, hostnames, attestationType, attestationDetails })
          }
        >
          {t('common.save')}
        </Button>
        {onCancel && (
          <Button variant="secondary" disabled={pending} onClick={onCancel}>
            {t('common.cancel')}
          </Button>
        )}
      </div>
    </div>
  );
}

export function ScopesTab() {
  const { t } = useTranslation();
  const { hasCapability } = useSession();
  const { data, isLoading } = useAuthorizedScopesQuery();
  const [showForm, setShowForm] = useState(false);
  const [supersedingScopeId, setSupersedingScopeId] = useState<string | null>(null);
  const create = useCreateAuthorizedScopeMutation();
  const supersede = useSupersedeAuthorizedScopeMutation();

  if (isLoading) return <p>{t('common.loading')}</p>;

  return (
    <div>
      <div className={styles.header}>
        {hasCapability('scopes.write') && (
          <Button
            variant="primary"
            onClick={() => {
              setSupersedingScopeId(null);
              setShowForm((v) => !v);
            }}
          >
            {t('scope.newScope')}
          </Button>
        )}
      </div>
      {!data?.items.length && <EmptyState title={t('scope.empty.scopes')} description="" />}
      <div className={styles.list}>
        {data?.items.map((scope) =>
          supersedingScopeId === scope.id ? (
            <ScopeForm
              key={scope.id}
              initial={{
                name: scope.name,
                cidrRanges: (scope.cidrRanges ?? []).join('\n'),
                hostnames: (scope.hostnames ?? []).join('\n'),
                attestationType: scope.attestationType,
                attestationDetails: '',
              }}
              pending={supersede.isPending}
              onCancel={() => setSupersedingScopeId(null)}
              onSave={(form) =>
                supersede.mutate(
                  {
                    scopeId: scope.id,
                    name: form.name,
                    cidrRanges: linesOf(form.cidrRanges),
                    hostnames: linesOf(form.hostnames),
                    attestationType: form.attestationType,
                    attestationDetails: form.attestationDetails,
                  },
                  { onSuccess: () => setSupersedingScopeId(null) },
                )
              }
            />
          ) : (
            <div key={scope.id} className={styles.row}>
              <div className={styles.rowMain}>
                <strong>{scope.name}</strong>
                <span className={styles.muted}>
                  {[...(scope.cidrRanges ?? []), ...(scope.hostnames ?? [])].join(', ')}
                </span>
              </div>
              <span className={styles.muted}>
                {t(`setup.scope.attestationTypes.${scope.attestationType}`)}
              </span>
              {scope.supersededById ? (
                <span className={styles.muted}>{t('scope.superseded')}</span>
              ) : (
                hasCapability('scopes.write') && (
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setShowForm(false);
                      setSupersedingScopeId(scope.id);
                    }}
                  >
                    {t('scope.supersede')}
                  </Button>
                )
              )}
            </div>
          ),
        )}
      </div>
      {showForm && (
        <ScopeForm
          initial={EMPTY_FORM}
          pending={create.isPending}
          onCancel={() => setShowForm(false)}
          onSave={(form) =>
            create.mutate(
              {
                name: form.name,
                cidrRanges: linesOf(form.cidrRanges),
                hostnames: linesOf(form.hostnames),
                attestationType: form.attestationType,
                attestationDetails: form.attestationDetails,
              },
              { onSuccess: () => setShowForm(false) },
            )
          }
        />
      )}
    </div>
  );
}
