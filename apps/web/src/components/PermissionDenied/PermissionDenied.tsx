import type { UserRole } from '@xenitex/domain';
import { useTranslation } from 'react-i18next';
import styles from './PermissionDenied.module.css';

export interface PermissionDeniedProps {
  readonly requiredRole: UserRole;
  /** Who can grant it — always an administrator in this release (UI-82: four fixed roles), stated plainly rather than assumed. */
  readonly grantedBy?: UserRole;
}

/** UI-61. Names the permission required and who can grant it — never a bare "access denied." */
export function PermissionDenied({
  requiredRole,
  grantedBy = 'administrator',
}: PermissionDeniedProps) {
  const { t } = useTranslation();
  return (
    <div className={styles.state} role="alert">
      <p className={styles.title}>{t('components.permissionDenied.title')}</p>
      <p className={styles.detail}>
        {t('components.permissionDenied.detail', {
          role: t(`common.roles.${requiredRole}`),
          grantedBy: t(`common.roles.${grantedBy}`),
        })}
      </p>
    </div>
  );
}
