import { useTranslation } from 'react-i18next';
import { EmptyState } from '../../components/EmptyState/EmptyState.js';
import { Stack } from '../../components/layout/Stack.js';
import { useAuthorizedScopesQuery } from '../useScansQueries.js';
import styles from './WizardSteps.module.css';

export function ScopeStep({
  selectedScopeId,
  onSelect,
}: {
  readonly selectedScopeId: string | undefined;
  readonly onSelect: (scopeId: string) => void;
}) {
  const { t } = useTranslation();
  const { data, isLoading } = useAuthorizedScopesQuery();

  if (isLoading) return <p>{t('common.loading')}</p>;
  if (!data?.items.length) {
    return (
      <EmptyState
        title={t('scope.empty.scopes')}
        description={t('scans.wizard.scope.description')}
      />
    );
  }

  return (
    <Stack>
      <p>{t('scans.wizard.scope.description')}</p>
      {data.items.map((scope) => (
        <label key={scope.id} className={styles.option} data-checked={scope.id === selectedScopeId}>
          <input
            type="radio"
            name="scope"
            checked={scope.id === selectedScopeId}
            onChange={() => onSelect(scope.id)}
          />
          <span>
            <strong>{scope.name}</strong>
            <p>{[...(scope.cidrRanges ?? []), ...(scope.hostnames ?? [])].join(', ')}</p>
          </span>
        </label>
      ))}
    </Stack>
  );
}
