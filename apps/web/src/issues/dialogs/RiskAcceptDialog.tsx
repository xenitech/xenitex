import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/form/Button.js';
import { Field, TextArea, TextInput } from '../../components/form/Field.js';
import { Dialog } from '../../components/primitives/Dialog.js';
import { Stack } from '../../components/layout/Stack.js';

const MAX_EXPIRY_DAYS = 365;
const DEFAULT_EXPIRY_DAYS = 90;

function isoDatePlusDays(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

export interface RiskAcceptDialogProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly onSubmit: (input: { justification: string; expiresAt: string }) => void;
  readonly isSubmitting: boolean;
}

/**
 * MOD-12: this creates an Exception request, NOT a direct issue-state
 * transition — risk acceptance requires an approver distinct from the
 * requester, so the issue only moves to `risk_accepted` once that approval
 * happens (see the Exceptions register, 3.7). A mandatory expiry with a
 * documented maximum (365 days) is enforced here as well as server-side.
 */
export function RiskAcceptDialog({
  isOpen,
  onClose,
  onSubmit,
  isSubmitting,
}: RiskAcceptDialogProps) {
  const { t } = useTranslation();
  const titleId = useId();
  const [justification, setJustification] = useState('');
  const [expiresAt, setExpiresAt] = useState(isoDatePlusDays(DEFAULT_EXPIRY_DAYS));

  return (
    <Dialog
      titleId={titleId}
      title={t('issues.detail.riskAcceptDialog.title')}
      isOpen={isOpen}
      onClose={onClose}
    >
      <Stack>
        <Field label={t('issues.detail.riskAcceptDialog.justification')}>
          <TextArea
            value={justification}
            onChange={(e) => setJustification(e.target.value)}
            rows={3}
            required
          />
        </Field>
        <Field label={t('issues.detail.riskAcceptDialog.expiresAt')}>
          <TextInput
            type="date"
            value={expiresAt}
            min={isoDatePlusDays(1)}
            max={isoDatePlusDays(MAX_EXPIRY_DAYS)}
            onChange={(e) => setExpiresAt(e.target.value)}
          />
        </Field>
        <Button
          variant="primary"
          disabled={isSubmitting || !justification || !expiresAt}
          onClick={() => onSubmit({ justification, expiresAt: new Date(expiresAt).toISOString() })}
        >
          {t('issues.detail.riskAcceptDialog.submit')}
        </Button>
      </Stack>
    </Dialog>
  );
}
