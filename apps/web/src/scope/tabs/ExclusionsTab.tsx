import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/form/Button.js';
import { Field, Select, TextInput } from '../../components/form/Field.js';
import { EmptyState } from '../../components/EmptyState/EmptyState.js';
import { useSession } from '../../auth/SessionContext.js';
import {
  useCreateExclusionRuleMutation,
  useExclusionRulesQuery,
  useSetExclusionRuleActiveMutation,
} from '../useScopeQueries.js';
import type { ExclusionRuleType } from '../../api/types.js';
import styles from '../../components/layout/TabPanel.module.css';

const RULE_TYPES: readonly ExclusionRuleType[] = ['address', 'range', 'port', 'tag'];

export function ExclusionsTab() {
  const { t } = useTranslation();
  const { hasCapability } = useSession();
  const { data, isLoading } = useExclusionRulesQuery();
  const [showForm, setShowForm] = useState(false);
  const [ruleType, setRuleType] = useState<ExclusionRuleType>('address');
  const [value, setValue] = useState('');
  const [reason, setReason] = useState('');
  const create = useCreateExclusionRuleMutation();
  const setActive = useSetExclusionRuleActiveMutation();

  if (isLoading) return <p>{t('common.loading')}</p>;

  return (
    <div>
      <div className={styles.header}>
        {hasCapability('scopes.write') && (
          <Button variant="primary" onClick={() => setShowForm((v) => !v)}>
            {t('scope.newExclusion')}
          </Button>
        )}
      </div>
      {!data?.items.length && <EmptyState title={t('scope.empty.exclusions')} description="" />}
      <div className={styles.list}>
        {data?.items.map((rule) => (
          <div key={rule.id} className={styles.row}>
            <div className={styles.rowMain}>
              <strong>
                {t(`scope.exclusionType.${rule.ruleType}`)}: {rule.value}
              </strong>
              <span className={styles.muted}>{rule.reason}</span>
            </div>
            <span className={styles.muted}>{rule.isActive ? '' : '(inactive)'}</span>
            {hasCapability('scopes.write') && (
              <Button
                variant={rule.isActive ? 'danger' : 'secondary'}
                disabled={setActive.isPending}
                onClick={() => {
                  const confirmed = rule.isActive
                    ? window.confirm(
                        `Deactivate this exclusion? Targets matching "${rule.value}" become scannable again as soon as this takes effect.`,
                      )
                    : true;
                  if (confirmed) setActive.mutate({ ruleId: rule.id, isActive: !rule.isActive });
                }}
              >
                {rule.isActive ? t('scope.deactivate') : t('scope.reactivate')}
              </Button>
            )}
          </div>
        ))}
      </div>
      {showForm && (
        <div className={styles.form}>
          <Field label={t('scope.tabs.exclusions')}>
            <Select
              value={ruleType}
              onChange={(e) => setRuleType(e.target.value as ExclusionRuleType)}
            >
              {RULE_TYPES.map((type) => (
                <option key={type} value={type}>
                  {t(`scope.exclusionType.${type}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('scope.exclusionValue')}>
            <TextInput
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="10.0.0.5 or 445 or pci-scope"
            />
          </Field>
          <Field label={t('scope.exclusionReason')}>
            <TextInput value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <Button
            variant="primary"
            disabled={create.isPending || !value || !reason}
            onClick={() =>
              create.mutate(
                { scopeId: null, ruleType, value, reason },
                { onSuccess: () => setShowForm(false) },
              )
            }
          >
            {t('common.save')}
          </Button>
        </div>
      )}
    </div>
  );
}
