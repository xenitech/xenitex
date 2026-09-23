import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { SignInScreen } from './SignInScreen.js';
import { MfaChallengeScreen } from './MfaChallengeScreen.js';
import { MfaEnrollScreen } from './MfaEnrollScreen.js';
import { ForcedPasswordChangeScreen } from './ForcedPasswordChangeScreen.js';
import { useSession } from './SessionContext.js';

/**
 * P1-07. The full sign-in gate, in enforcement order: credentials → MFA
 * challenge (if already enrolled) → forced password change (P1-07,
 * administrator-provisioned accounts) → mandatory MFA enrolment (SEC-09,
 * operator/administrator) → the actual app. Each gate is a hard stop — the
 * app underneath never mounts until every one clears, matching how the real
 * backend would refuse any other request until the session reflects it.
 */
export function AuthGate({ children }: { readonly children: ReactNode }) {
  const { t } = useTranslation();
  const { currentUser, isLoading, isSignedIn, hasCapability } = useSession();
  const [challengeToken, setChallengeToken] = useState<string | undefined>(undefined);

  if (isLoading) {
    return (
      <div role="status" aria-live="polite" style={{ padding: 'var(--space-9)' }}>
        {t('common.loading')}
      </div>
    );
  }

  if (!isSignedIn) {
    return challengeToken ? (
      <MfaChallengeScreen challengeToken={challengeToken} />
    ) : (
      <SignInScreen onMfaRequired={setChallengeToken} />
    );
  }

  const user = currentUser!.user;

  if (user.mustChangePassword) {
    return <ForcedPasswordChangeScreen />;
  }

  // SEC-09/SEC-13. The SERVER decides whether enrolment is required — it
  // reports `auth.mfaEnrollmentRequired` based on its own
  // MFA_ENFORCEMENT configuration and the account's role, and it refuses
  // every route outside its enrolment allowlist regardless of what this
  // component does. Reading the capability rather than re-deriving the
  // rule here is what stops the panel and the API disagreeing about
  // whether an account is gated, which is exactly how the old
  // client-side override managed to disable the control outright.
  if (hasCapability('auth.mfaEnrollmentRequired') && !user.mfaEnabled) {
    return <MfaEnrollScreen />;
  }

  return <>{children}</>;
}
