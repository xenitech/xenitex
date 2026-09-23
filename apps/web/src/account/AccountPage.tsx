import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../components/form/Button.js';
import { Stack } from '../components/layout/Stack.js';
import { useSession } from '../auth/SessionContext.js';
import { MfaEnrollFlow } from '../auth/MfaEnrollScreen.js';
import styles from '../scope/ScopePage.module.css';
import accountStyles from './AccountPage.module.css';

/**
 * The signed-in user's own security settings.
 *
 * This page exists so TOTP enrolment is reachable on purpose, not only as
 * the hard gate a privileged account is forced through. With the appliance
 * configured `MFA_ENFORCEMENT=optional` nobody is forced to enrol, but
 * anyone who wants a second factor can turn one on here — and once they
 * have, the server requires their TOTP code at every subsequent login,
 * exactly as it does for a mandated account. Enrolment is voluntary;
 * what it protects is not optional afterwards.
 */
export function AccountPage() {
  const { t } = useTranslation();
  const { currentUser, invalidate, hasCapability } = useSession();
  const [enrolling, setEnrolling] = useState(false);

  if (!currentUser) return null;
  const { user } = currentUser;
  const enrolmentRequired = hasCapability('auth.mfaEnrollmentRequired');

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>{t('account.title')}</h1>

      <section className={accountStyles.card} aria-labelledby="account-identity">
        <h2 id="account-identity" className={accountStyles.cardTitle}>
          {t('account.identity.title')}
        </h2>
        <dl className={accountStyles.details}>
          <dt>{t('account.identity.name')}</dt>
          <dd>{user.displayName}</dd>
          <dt>{t('account.identity.email')}</dt>
          <dd>{user.email}</dd>
          <dt>{t('account.identity.role')}</dt>
          <dd>{t(`common.roles.${user.role}`)}</dd>
        </dl>
      </section>

      <section className={accountStyles.card} aria-labelledby="account-mfa">
        <h2 id="account-mfa" className={accountStyles.cardTitle}>
          {t('account.mfa.title')}
        </h2>

        {user.mfaEnabled ? (
          <Stack>
            <p className={accountStyles.enabled}>{t('account.mfa.enabled')}</p>
            {/* Deliberately no "disable" control. Turning a second factor
                off is an account-recovery action an administrator performs
                against the user record, not something a live session can do
                to itself — the same reasoning that makes re-enrolment
                return 409 server-side. A stolen session must not be able to
                remove the thing standing in its way. */}
            <p className={accountStyles.note}>{t('account.mfa.disableNote')}</p>
          </Stack>
        ) : enrolling ? (
          <MfaEnrollFlow
            onDone={() => {
              setEnrolling(false);
              void invalidate();
            }}
          />
        ) : (
          <Stack>
            <p>
              {enrolmentRequired
                ? t('account.mfa.requiredDescription')
                : t('account.mfa.optionalDescription')}
            </p>
            <div>
              <Button variant="primary" onClick={() => setEnrolling(true)}>
                {t('account.mfa.enable')}
              </Button>
            </div>
          </Stack>
        )}
      </section>
    </div>
  );
}
