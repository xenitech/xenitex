import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/form/Button.js';
import { Field, Select, TextInput } from '../../components/form/Field.js';
import { EmptyState } from '../../components/EmptyState/EmptyState.js';
import { useSession } from '../../auth/SessionContext.js';
import {
  useCreateScanProfileMutation,
  useScanProfilesQuery,
  useUpdateScanProfileMutation,
} from '../useScopeQueries.js';
import type { IntrusivenessProfile } from '../../api/types.js';
import styles from '../../components/layout/TabPanel.module.css';

const INTRUSIVENESS: readonly IntrusivenessProfile[] = ['passive-inventory', 'safe', 'standard'];

interface ProfileFormState {
  readonly name: string;
  readonly intrusiveness: IntrusivenessProfile;
  readonly packetsPerSecond: number;
  readonly concurrentHosts: number;
}

function ProfileForm({
  initial,
  pending,
  onSave,
  onCancel,
}: {
  readonly initial: ProfileFormState;
  readonly pending: boolean;
  readonly onSave: (state: ProfileFormState) => void;
  readonly onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState(initial.name);
  const [intrusiveness, setIntrusiveness] = useState(initial.intrusiveness);
  const [packetsPerSecond, setPacketsPerSecond] = useState(initial.packetsPerSecond);
  const [concurrentHosts, setConcurrentHosts] = useState(initial.concurrentHosts);

  return (
    <div className={styles.form}>
      <Field label={t('setup.scope.name')}>
        <TextInput value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label={t('scans.wizard.steps.profile')}>
        <Select
          value={intrusiveness}
          onChange={(e) => setIntrusiveness(e.target.value as IntrusivenessProfile)}
        >
          {INTRUSIVENESS.map((i) => (
            <option key={i} value={i}>
              {i}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="packets/sec">
        <TextInput
          type="number"
          value={packetsPerSecond}
          onChange={(e) => setPacketsPerSecond(Number(e.target.value))}
        />
      </Field>
      <Field label="concurrent hosts">
        <TextInput
          type="number"
          value={concurrentHosts}
          onChange={(e) => setConcurrentHosts(Number(e.target.value))}
        />
      </Field>
      <div className={styles.header}>
        <Button
          variant="primary"
          disabled={pending || !name}
          onClick={() => onSave({ name, intrusiveness, packetsPerSecond, concurrentHosts })}
        >
          {t('common.save')}
        </Button>
        <Button variant="secondary" disabled={pending} onClick={onCancel}>
          {t('common.cancel')}
        </Button>
      </div>
    </div>
  );
}

export function ProfilesTab() {
  const { t } = useTranslation();
  const { hasCapability } = useSession();
  const { data, isLoading } = useScanProfilesQuery();
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [editingProfileId, setEditingProfileId] = useState<string | null>(null);
  const create = useCreateScanProfileMutation();
  const update = useUpdateScanProfileMutation();

  if (isLoading) return <p>{t('common.loading')}</p>;

  return (
    <div>
      <div className={styles.header}>
        {hasCapability('scopes.write') && (
          <Button
            variant="primary"
            onClick={() => {
              setEditingProfileId(null);
              setShowCreateForm((v) => !v);
            }}
          >
            {t('scope.newProfile')}
          </Button>
        )}
      </div>
      {!data?.length && <EmptyState title={t('scope.empty.profiles')} description="" />}
      <div className={styles.list}>
        {data?.map((profile) =>
          editingProfileId === profile.id ? (
            <ProfileForm
              key={profile.id}
              initial={{
                name: profile.name,
                intrusiveness: profile.intrusiveness,
                packetsPerSecond: profile.pacing.packetsPerSecond,
                concurrentHosts: profile.pacing.concurrentHosts,
              }}
              pending={update.isPending}
              onCancel={() => setEditingProfileId(null)}
              onSave={(form) =>
                update.mutate(
                  {
                    profileId: profile.id,
                    name: form.name,
                    intrusiveness: form.intrusiveness,
                    pacing: {
                      packetsPerSecond: form.packetsPerSecond,
                      concurrentHosts: form.concurrentHosts,
                      concurrentPortsPerHost: profile.pacing.concurrentPortsPerHost,
                      timeoutMs: profile.pacing.timeoutMs,
                      retries: profile.pacing.retries,
                    },
                  },
                  { onSuccess: () => setEditingProfileId(null) },
                )
              }
            />
          ) : (
            <div key={profile.id} className={styles.row}>
              <div className={styles.rowMain}>
                <strong>{profile.name}</strong>
                <span className={styles.muted}>
                  {profile.intrusiveness} · {profile.pacing.packetsPerSecond} pps ·{' '}
                  {profile.pacing.concurrentHosts} hosts
                </span>
              </div>
              {profile.requiresConfirmation && (
                <span className={styles.muted}>⚑ requires confirmation</span>
              )}
              {hasCapability('scopes.write') && (
                <Button
                  variant="secondary"
                  onClick={() => {
                    setShowCreateForm(false);
                    setEditingProfileId(profile.id);
                  }}
                >
                  {t('scope.edit')}
                </Button>
              )}
            </div>
          ),
        )}
      </div>
      {showCreateForm && (
        <ProfileForm
          initial={{ name: '', intrusiveness: 'safe', packetsPerSecond: 50, concurrentHosts: 20 }}
          pending={create.isPending}
          onCancel={() => setShowCreateForm(false)}
          onSave={(form) =>
            create.mutate(
              {
                name: form.name,
                intrusiveness: form.intrusiveness,
                pacing: {
                  packetsPerSecond: form.packetsPerSecond,
                  concurrentHosts: form.concurrentHosts,
                  concurrentPortsPerHost: 10,
                  timeoutMs: 3000,
                  retries: 1,
                },
              },
              { onSuccess: () => setShowCreateForm(false) },
            )
          }
        />
      )}
    </div>
  );
}
