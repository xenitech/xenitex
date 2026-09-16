import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/form/Button.js';
import { Field, TextInput } from '../../components/form/Field.js';
import { Stack } from '../../components/layout/Stack.js';
import { useScanProfilesQuery } from '../useScansQueries.js';
import styles from './WizardSteps.module.css';

const REQUIRED_CONFIRMATION_TEXT = 'CONFIRM';

export function ProfileStep({
  selectedProfileId,
  onSelect,
  onBack,
}: {
  readonly selectedProfileId: string | undefined;
  readonly onSelect: (profileId: string, standardConfirmationText: string | undefined) => void;
  readonly onBack: () => void;
}) {
  const { t } = useTranslation();
  const { data, isLoading } = useScanProfilesQuery();
  const [localSelection, setLocalSelection] = useState(selectedProfileId);
  const [confirmationText, setConfirmationText] = useState('');

  if (isLoading) return <p>{t('common.loading')}</p>;

  const selectedProfile = data?.find((p) => p.id === localSelection);
  const needsTypedConfirmation = selectedProfile?.requiresConfirmation === true;
  const canProceed =
    Boolean(localSelection) &&
    (!needsTypedConfirmation || confirmationText === REQUIRED_CONFIRMATION_TEXT);

  return (
    <Stack>
      <p>{t('scans.wizard.profile.description')}</p>
      {data?.map((profile) => (
        <label
          key={profile.id}
          className={styles.option}
          data-checked={profile.id === localSelection}
        >
          <input
            type="radio"
            name="profile"
            checked={profile.id === localSelection}
            onChange={() => {
              setLocalSelection(profile.id);
              setConfirmationText('');
            }}
          />
          <span>
            <strong>{profile.name}</strong>
            <p>{profile.intrusiveness}</p>
          </span>
        </label>
      ))}
      {needsTypedConfirmation && (
        <Field label={t('scans.wizard.profile.confirmStandard')}>
          <TextInput
            value={confirmationText}
            onChange={(e) => setConfirmationText(e.target.value)}
            placeholder={t('scans.wizard.profile.confirmPlaceholder')}
          />
        </Field>
      )}
      <div className={styles.footer}>
        <Button variant="secondary" onClick={onBack}>
          {t('common.back')}
        </Button>
        <Button
          variant="primary"
          disabled={!canProceed}
          onClick={() =>
            localSelection &&
            onSelect(localSelection, needsTypedConfirmation ? confirmationText : undefined)
          }
        >
          {t('common.next')}
        </Button>
      </div>
    </Stack>
  );
}
