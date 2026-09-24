import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Logo } from '../components/Logo/Logo.js';
import styles from './AuthLayout.module.css';

/**
 * The shared frame around every pre-authentication screen (sign-in, MFA
 * challenge/enrolment, forced password change, and the setup wizard) —
 * the one moment in the product where a fuller brand presentation belongs.
 * Everything past this point (the actual app, behind `AuthGate`) stays the
 * restrained, risk-colour-only chrome UI-02/UI-10 require; this layer never
 * wraps authenticated screens.
 */
export function AuthLayout({ children }: { readonly children: ReactNode }) {
  const { t } = useTranslation();
  return (
    <div className={styles.page}>
      <div className={styles.glow} aria-hidden="true" />
      <div className={styles.content}>
        <Logo variant="lockup" />
        <p className={styles.tagline}>{t('auth.tagline')}</p>
        {children}
      </div>
    </div>
  );
}
