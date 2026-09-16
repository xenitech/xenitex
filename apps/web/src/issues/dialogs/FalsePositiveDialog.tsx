import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/form/Button.js';
import { Field, Select, TextArea } from '../../components/form/Field.js';
import { Dialog } from '../../components/primitives/Dialog.js';
import { Stack } from '../../components/layout/Stack.js';
import type { FalsePositiveReasonCode } from '../../api/types.js';

const REASON_CODES: readonly FalsePositiveReasonCode[] = [
  'not_applicable_environment',
  'patched_not_reflected',
  'false_signature_match',
  'compensating_control',
  'duplicate_of_other_issue',
  'other',
];

export interface FalsePositiveDialogProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly onSubmit: (input: { reasonCode: string; justification: string }) => void;
  readonly isSubmitting: boolean;
}

/** MOD-11: false_positive requires a controlled-vocabulary reason plus free-text justification. */
export function FalsePositiveDialog({
  isOpen,
  onClose,
  onSubmit,
  isSubmitting,
}: FalsePositiveDialogProps) {
  const { t } = useTranslation();
  const titleId = useId();
  const [reasonCode, setReasonCode] = useState<FalsePositiveReasonCode>(
    'not_applicable_environment',
  );
  const [justification, setJustification] = useState('');

  return (
    <Dialog
      titleId={titleId}
      title={t('issues.detail.falsePositiveDialog.title')}
      isOpen={isOpen}
      onClose={onClose}
    >
      <Stack>
        <Field label={t('issues.detail.falsePositiveDialog.reasonCode')}>
          <Select
            value={reasonCode}
            onChange={(e) => setReasonCode(e.target.value as FalsePositiveReasonCode)}
          >
            {REASON_CODES.map((code) => (
              <option key={code} value={code}>
                {t(`issues.detail.falsePositiveDialog.reasonCodes.${code}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('issues.detail.falsePositiveDialog.justification')}>
          <TextArea
            value={justification}
            onChange={(e) => setJustification(e.target.value)}
            rows={3}
            required
          />
        </Field>
        <Button
          variant="primary"
          disabled={isSubmitting || !justification}
          onClick={() => onSubmit({ reasonCode, justification })}
        >
          {t('issues.detail.falsePositiveDialog.submit')}
        </Button>
      </Stack>
    </Dialog>
  );
}
