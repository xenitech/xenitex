import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { WizardProgress } from '../components/layout/WizardProgress.js';
import { ScopeStep } from './wizard/ScopeStep.js';
import { ProfileStep } from './wizard/ProfileStep.js';
import { ScheduleStep } from './wizard/ScheduleStep.js';
import { ReviewStep } from './wizard/ReviewStep.js';
import styles from './NewScanWizardPage.module.css';

const STEPS = ['scope', 'profile', 'schedule', 'review'] as const;
type Step = (typeof STEPS)[number];

export function NewScanWizardPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>('scope');
  const [scopeId, setScopeId] = useState<string | undefined>(undefined);
  const [profileId, setProfileId] = useState<string | undefined>(undefined);
  const [standardConfirmationText, setStandardConfirmationText] = useState<string | undefined>(
    undefined,
  );

  const stepIndex = STEPS.indexOf(step);

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>{t('scans.newScan')}</h1>
      <WizardProgress
        steps={STEPS.map((s) => t(`scans.wizard.steps.${s}`))}
        currentIndex={stepIndex}
      />
      <div className={styles.body}>
        {step === 'scope' && (
          <ScopeStep
            selectedScopeId={scopeId}
            onSelect={(id) => {
              setScopeId(id);
              setStep('profile');
            }}
          />
        )}
        {step === 'profile' && scopeId && (
          <ProfileStep
            selectedProfileId={profileId}
            onSelect={(id, confirmationText) => {
              setProfileId(id);
              setStandardConfirmationText(confirmationText);
              setStep('schedule');
            }}
            onBack={() => setStep('scope')}
          />
        )}
        {step === 'schedule' && scopeId && profileId && (
          <ScheduleStep
            scopeId={scopeId}
            profileId={profileId}
            onRunNow={() => setStep('review')}
            onScheduled={() => navigate('/scans')}
            onBack={() => setStep('profile')}
          />
        )}
        {step === 'review' && scopeId && profileId && (
          <ReviewStep
            scopeId={scopeId}
            profileId={profileId}
            standardProfileConfirmationText={standardConfirmationText}
            onStarted={(scanRunId) => navigate(`/scans/${scanRunId}`)}
            onBack={() => setStep('schedule')}
          />
        )}
      </div>
    </div>
  );
}
