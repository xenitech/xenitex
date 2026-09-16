import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { SignInScreen } from './SignInScreen.js';
import { MfaChallengeScreen } from './MfaChallengeScreen.js';
import { MfaEnrollScreen } from './MfaEnrollScreen.js';
import { ForcedPasswordChangeScreen } from './ForcedPasswordChangeScreen.js';
import { useSession } from './SessionContext.js';

const MFA_MANDATORY_ROLES = new Set(['operator', 'administrator']);

// TEMPORARY, explicitly requested to unblock pilot-panel access during
// setup testing: flip back to `false` before any real deployment.
// SEC-09 still requires mandatory MFA for operator/administrator — this
// only skips the *frontend* enrollment gate below. The backend never
// required MFA at login in the first place unless mfa_enabled is already
// true (it only demands a TOTP challenge for accounts that finished
// enrollment), so this one flag is the entire bypass; nothing server-side
// changed and nothing server-side needs to.
const MFA_ENFORCEMENT_DISABLED_FOR_NOW = true;

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
  const { currentUser, isLoading, isSignedIn } = useSession();
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

  if (!MFA_ENFORCEMENT_DISABLED_FOR_NOW && MFA_MANDATORY_ROLES.has(user.role) && !user.mfaEnabled) {
    return <MfaEnrollScreen />;
  }

  return <>{children}</>;
}
