import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScopesTab } from './tabs/ScopesTab.js';
import { ExclusionsTab } from './tabs/ExclusionsTab.js';
import { ProfilesTab } from './tabs/ProfilesTab.js';
import { BlackoutsTab } from './tabs/BlackoutsTab.js';
import { SchedulesTab } from './tabs/SchedulesTab.js';
import styles from './ScopePage.module.css';

const TABS = ['scopes', 'exclusions', 'profiles', 'blackouts', 'schedules'] as const;
type Tab = (typeof TABS)[number];

export function ScopePage() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>('scopes');

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>{t('scope.title')}</h1>
      <div className={styles.tabs} role="tablist">
        {TABS.map((key) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            className={tab === key ? styles.tabActive : styles.tab}
            onClick={() => setTab(key)}
          >
            {t(`scope.tabs.${key}`)}
          </button>
        ))}
      </div>
      <div className={styles.tabPanel}>
        {tab === 'scopes' && <ScopesTab />}
        {tab === 'exclusions' && <ExclusionsTab />}
        {tab === 'profiles' && <ProfilesTab />}
        {tab === 'blackouts' && <BlackoutsTab />}
        {tab === 'schedules' && <SchedulesTab />}
      </div>
    </div>
  );
}
