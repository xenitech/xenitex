import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PermissionDenied } from '../components/PermissionDenied/PermissionDenied.js';
import { useSession } from '../auth/SessionContext.js';
import { UsersTab } from './tabs/UsersTab.js';
import { NotificationsTab } from './tabs/NotificationsTab.js';
import { RetentionTab } from './tabs/RetentionTab.js';
import { BackupTab } from './tabs/BackupTab.js';
import { FeatureFlagsTab } from './tabs/FeatureFlagsTab.js';
import { AuditTab } from './tabs/AuditTab.js';
import { SystemHealthTab } from './tabs/SystemHealthTab.js';
import { IntelligenceTab } from './tabs/IntelligenceTab.js';
import styles from '../scope/ScopePage.module.css';

const TABS = [
  'users',
  'notifications',
  'retention',
  'backup',
  'featureFlags',
  'audit',
  'health',
  'intelligence',
] as const;
type Tab = (typeof TABS)[number];

/** Administration is administrator-only (P1-23 cosmetic gate; SEC-13 enforces server-side regardless). */
export function AdminPage() {
  const { t } = useTranslation();
  const { currentUser } = useSession();
  const [tab, setTab] = useState<Tab>('users');

  if (currentUser && currentUser.user.role !== 'administrator') {
    return <PermissionDenied requiredRole="administrator" />;
  }

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>{t('admin.title')}</h1>
      <div className={styles.tabs} role="tablist">
        {TABS.map((key) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            className={tab === key ? styles.tabActive : styles.tab}
            onClick={() => setTab(key)}
          >
            {t(`admin.tabs.${key}`)}
          </button>
        ))}
      </div>
      <div className={styles.tabPanel}>
        {tab === 'users' && <UsersTab />}
        {tab === 'notifications' && <NotificationsTab />}
        {tab === 'retention' && <RetentionTab />}
        {tab === 'backup' && <BackupTab />}
        {tab === 'featureFlags' && <FeatureFlagsTab />}
        {tab === 'audit' && <AuditTab />}
        {tab === 'health' && <SystemHealthTab />}
        {tab === 'intelligence' && <IntelligenceTab />}
      </div>
    </div>
  );
}
