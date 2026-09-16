import { useMutation } from '@tanstack/react-query';
import { NavLink, Outlet } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { apiClient } from '../api/client.js';
import { unwrap } from '../api/error.js';
import { useSession } from '../auth/SessionContext.js';
import { SUPPORTED_LANGUAGES, storeLanguage, type SupportedLanguage } from '../i18n/index.js';
import { useTheme } from '../theme/ThemeContext.js';
import { GlobalStopControl } from './GlobalStopControl.js';
import styles from './AppShell.module.css';

/** Keep in sync with `app/router.tsx`. */
const NAV_ITEMS = [
  { to: '/', key: 'dashboard', end: true },
  { to: '/issues', key: 'issues' },
  { to: '/assets', key: 'assets' },
  { to: '/scans', key: 'scans' },
  { to: '/scope', key: 'scope' },
  { to: '/exceptions', key: 'exceptions' },
  { to: '/reports', key: 'reports' },
  { to: '/admin', key: 'admin' },
] as const;

export function AppShell() {
  const { t, i18n } = useTranslation();
  const { currentUser, invalidate } = useSession();
  const { theme, setTheme } = useTheme();

  const logout = useMutation({
    mutationFn: async () => unwrap(await apiClient.POST('/auth/logout')),
    onSuccess: () => void invalidate(),
  });

  return (
    <div className={styles.shell}>
      <a href="#main-content" className={styles.skipLink}>
        {t('nav.skipToContent')}
      </a>
      <header className={styles.topBar}>
        <span className={styles.brand}>Xenitex</span>
        <div className={styles.topBarActions}>
          <GlobalStopControl />
          <select
            aria-label={t('common.language')}
            value={i18n.language}
            onChange={(e) => {
              const lang = e.target.value as SupportedLanguage;
              storeLanguage(lang);
              void i18n.changeLanguage(lang);
            }}
          >
            {SUPPORTED_LANGUAGES.map((lang) => (
              <option key={lang} value={lang}>
                {lang === 'en' ? 'English' : 'فارسی'}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            aria-label={t('common.theme')}
          >
            {theme === 'dark' ? t('common.themeLight') : t('common.themeDark')}
          </button>
          {currentUser && (
            <span className={styles.user}>
              {currentUser.user.displayName} · {t(`common.roles.${currentUser.user.role}`)}
            </span>
          )}
          <button type="button" onClick={() => logout.mutate()}>
            {t('nav.signOut')}
          </button>
        </div>
      </header>
      <div className={styles.body}>
        <nav className={styles.sideNav} aria-label={t('nav.dashboard')}>
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={'end' in item}
              className={({ isActive }) => (isActive ? styles.navItemActive : styles.navItem)}
            >
              {t(`nav.${item.key}`)}
            </NavLink>
          ))}
        </nav>
        <main id="main-content" className={styles.main} tabIndex={-1}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
