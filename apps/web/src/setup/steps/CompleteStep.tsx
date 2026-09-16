import { useTranslation } from 'react-i18next';
import { Button } from '../../components/form/Button.js';
import { Stack } from '../../components/layout/Stack.js';

export function CompleteStep({
  onEnterApp,
  isSubmitting,
}: {
  readonly onEnterApp: () => void;
  readonly isSubmitting: boolean;
}) {
  const { t } = useTranslation();
  return (
    <Stack>
      <h2>{t('setup.complete.title')}</h2>
      <p>{t('setup.complete.description')}</p>
      <Button variant="primary" onClick={onEnterApp} disabled={isSubmitting}>
        {t('setup.complete.enterApp')}
      </Button>
    </Stack>
  );
}
