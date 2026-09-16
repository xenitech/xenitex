import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { apiClient } from '../api/client.js';
import { unwrap } from '../api/error.js';
import { Button } from '../components/form/Button.js';
import { EmptyState } from '../components/EmptyState/EmptyState.js';
import { ErrorState } from '../components/ErrorState/ErrorState.js';
import { ApiError } from '../api/error.js';
import { WizardProgress } from '../components/layout/WizardProgress.js';
import { SETUP_STATUS_QUERY_KEY, useSetupStatus } from './useSetupStatus.js';
import { AdministratorStep } from './steps/AdministratorStep.js';
import { OrganizationStep } from './steps/OrganizationStep.js';
import { TlsStep } from './steps/TlsStep.js';
import { ScopeStep } from './steps/ScopeStep.js';
import { SafetyStep } from './steps/SafetyStep.js';
import { CompleteStep } from './steps/CompleteStep.js';
import styles from './SetupWizardPage.module.css';

const STEP_ORDER = ['administrator', 'organization', 'tls', 'scope', 'safety'] as const;
type StepKey = (typeof STEP_ORDER)[number];

export interface SetupWizardPageProps {
  readonly onSetupComplete: () => void;
}

/** P1-06. Drives itself entirely off /setup/status (SetupStatus) — a refresh mid-wizard resumes at the first incomplete step, never loses progress. */
export function SetupWizardPage({ onSetupComplete }: SetupWizardPageProps) {
  const { t } = useTranslation();
  const { data: status, isLoading, isError, error, refetch } = useSetupStatus();
  const queryClient = useQueryClient();
  const [manualStep, setManualStep] = useState<StepKey | 'complete' | undefined>(undefined);

  const firstIncompleteStep = useMemo((): StepKey | 'complete' => {
    if (!status) return 'administrator';
    if (!status.administratorCreated) return 'administrator';
    if (!status.organizationConfigured) return 'organization';
    if (!status.tlsConfigured) return 'tls';
    if (!status.initialScopeDeclared) return 'scope';
    if (!status.safetyAcknowledged) return 'safety';
    return 'complete';
  }, [status]);

  const currentStep = manualStep ?? firstIncompleteStep;

  const invalidateStatus = () =>
    queryClient.invalidateQueries({ queryKey: SETUP_STATUS_QUERY_KEY });

  const completeMutation = useMutation({
    mutationFn: async () => unwrap(await apiClient.POST('/setup/complete')),
    onSuccess: () => {
      onSetupComplete();
    },
  });

  if (isLoading) {
    return (
      <div className={styles.page} role="status" aria-live="polite">
        {t('common.loading')}
      </div>
    );
  }

  if (isError) {
    const apiErr = error instanceof ApiError ? error : undefined;
    return (
      <div className={styles.page}>
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

  if (!status) {
    return <EmptyState title={t('components.errorState.title')} description="" />;
  }

  const stepIndex =
    currentStep === 'complete' ? STEP_ORDER.length : STEP_ORDER.indexOf(currentStep as StepKey);
  const advance = (next: StepKey | 'complete') => {
    setManualStep(undefined); // let status drive it again — /setup/status is the source of truth
    void invalidateStatus().then(() => setManualStep(next === 'complete' ? 'complete' : next));
  };

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>{t('setup.title')}</h1>
      {currentStep !== 'complete' && (
        <WizardProgress
          steps={STEP_ORDER.map((s) => t(`setup.steps.${s}`))}
          currentIndex={stepIndex}
        />
      )}
      <div className={styles.stepBody}>
        {currentStep === 'administrator' && (
          <AdministratorStep onDone={() => advance('organization')} />
        )}
        {currentStep === 'organization' && <OrganizationStep onDone={() => advance('tls')} />}
        {currentStep === 'tls' && <TlsStep onDone={() => advance('scope')} />}
        {currentStep === 'scope' && <ScopeStep onDone={() => advance('safety')} />}
        {currentStep === 'safety' && <SafetyStep onDone={() => advance('complete')} />}
        {currentStep === 'complete' && (
          <CompleteStep
            onEnterApp={() => completeMutation.mutate()}
            isSubmitting={completeMutation.isPending}
          />
        )}
      </div>
    </div>
  );
}
