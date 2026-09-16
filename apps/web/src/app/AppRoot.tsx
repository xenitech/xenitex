import { useTranslation } from 'react-i18next';
import { RouterProvider } from 'react-router-dom';
import { DocumentLanguageSync } from '../i18n/DocumentLanguageSync.js';
import { AuthGate } from '../auth/AuthGate.js';
import { ApiError } from '../api/error.js';
import { Button } from '../components/form/Button.js';
import { ErrorState } from '../components/ErrorState/ErrorState.js';
import { SetupWizardPage } from '../setup/SetupWizardPage.js';
import { useSetupStatus } from '../setup/useSetupStatus.js';
import { router } from './router.js';

export function AppRoot() {
  const { t } = useTranslation();
  const { data: setupStatus, isLoading, isError, error, refetch } = useSetupStatus();

  if (isLoading) return null;

  if (isError) {
    const apiErr = error instanceof ApiError ? error : undefined;
    return (
      <div style={{ padding: 'var(--space-9)' }}>
        <ErrorState
          title={t('components.errorState.title')}
          detail={apiErr?.detail ?? t('components.errorState.title')}
          code={apiErr?.code ?? 'unknown'}
          correlationId={apiErr?.correlationId ?? 'unavailable'}
        />
        <Button variant="primary" onClick={() => refetch()}>
          {t('common.retry')}
        </Button>
      </div>
    );
  }

  return (
    <>
      <DocumentLanguageSync />
      {!setupStatus?.setupCompleted ? (
        <SetupWizardPage onSetupComplete={() => window.location.assign('/')} />
      ) : (
        <AuthGate>
          <RouterProvider router={router} />
        </AuthGate>
      )}
    </>
  );
}
