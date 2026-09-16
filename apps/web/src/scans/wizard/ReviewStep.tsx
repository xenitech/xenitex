import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { apiClient } from '../../api/client.js';
import { unwrap } from '../../api/error.js';
import { Button } from '../../components/form/Button.js';
import { ErrorState } from '../../components/ErrorState/ErrorState.js';
import { Stack } from '../../components/layout/Stack.js';
import { ApiError } from '../../api/error.js';
import {
  useCreateScanPlanMutation,
  useCreateScanRunMutation,
  useScanProfilesQuery,
} from '../useScansQueries.js';
import styles from './ReviewStep.module.css';

function useExclusionRulesMap(scopeId: string) {
  return useQuery({
    queryKey: ['exclusion-rules', scopeId],
    queryFn: async () =>
      unwrap(
        await apiClient.GET('/exclusion-rules', { params: { query: { scopeId, limit: 200 } } }),
      ),
  });
}

function usePacingCeilings() {
  return useQuery({
    queryKey: ['pacing-ceilings'],
    queryFn: async () => unwrap(await apiClient.GET('/pacing-ceilings')),
  });
}

/**
 * SAFE-08's "most carefully designed screen" (docs/design/wireframe-scan-review.md):
 * `Start scan` stays disabled — never a spinner — until every computed
 * section (target count, packet volume, duration, exclusions, fragile
 * downgrades, pacing) has real numbers. That's the safety guarantee, not a
 * UX nicety: an analyst can never confirm a plan they haven't actually seen.
 */
export function ReviewStep({
  scopeId,
  profileId,
  standardProfileConfirmationText,
  onStarted,
  onBack,
}: {
  readonly scopeId: string;
  readonly profileId: string;
  readonly standardProfileConfirmationText: string | undefined;
  readonly onStarted: (scanRunId: string) => void;
  readonly onBack: () => void;
}) {
  const { t } = useTranslation();
  const planMutation = useCreateScanPlanMutation();
  const runMutation = useCreateScanRunMutation();
  const profilesQuery = useScanProfilesQuery();
  const exclusionRulesQuery = useExclusionRulesMap(scopeId);
  const ceilingsQuery = usePacingCeilings();
  const requestedRef = useRef(false);

  useEffect(() => {
    if (!requestedRef.current) {
      requestedRef.current = true;
      planMutation.mutate({ scopeId, profileId });
    }
  }, [scopeId, profileId, planMutation]);

  const plan = planMutation.data;
  const profile = profilesQuery.data?.find((p) => p.id === profileId);
  const ceilings = ceilingsQuery.data;
  const ruleReasonById = new Map(
    (exclusionRulesQuery.data?.items ?? []).map((r) => [r.id, r.reason]),
  );

  const isComputing = planMutation.isPending || !plan || !profile || !ceilings;

  if (planMutation.isError) {
    const err = planMutation.error instanceof ApiError ? planMutation.error : undefined;
    return (
      <Stack>
        <ErrorState
          title={t('components.errorState.title')}
          detail={err?.detail ?? ''}
          code={err?.code ?? 'unknown'}
          correlationId={err?.correlationId ?? 'unavailable'}
        />
        <Button variant="secondary" onClick={onBack}>
          {t('common.back')}
        </Button>
      </Stack>
    );
  }

  return (
    <Stack>
      <h2 className={styles.title}>{t('scans.wizard.review.title')}</h2>
      {isComputing ? (
        <p>{t('scans.wizard.review.computing')}</p>
      ) : (
        <Stack>
          <div className={styles.grid}>
            <span>{t('scans.wizard.review.targetCount')}</span>
            <strong>{plan.targetCount}</strong>
            <span>{t('scans.wizard.review.estimatedPackets')}</span>
            <strong>{plan.estimatedPacketVolume.toLocaleString()}</strong>
            <span>{t('scans.wizard.review.estimatedDuration')}</span>
            <strong>{Math.round(plan.estimatedDurationSeconds / 60)} min</strong>
          </div>

          <div>
            <h3 className={styles.sectionTitle}>
              {t('scans.wizard.review.excludedTargets')} ({plan.excludedTargets.length})
            </h3>
            {plan.excludedTargets.length === 0 && <p className={styles.muted}>—</p>}
            {plan.excludedTargets.map((excluded, i) => (
              <p key={i} className={styles.muted}>
                {excluded.target} — {t('scans.wizard.review.excludedByRule')}:{' '}
                {ruleReasonById.get(excluded.ruleId) ?? excluded.ruleId}
              </p>
            ))}
          </div>

          <div>
            <h3 className={styles.sectionTitle}>
              {t('scans.wizard.review.fragileDowngrades')} ({plan.fragileDowngrades.length})
            </h3>
            {plan.fragileDowngrades.length === 0 && <p className={styles.muted}>—</p>}
            {plan.fragileDowngrades.map((downgrade, i) => (
              <p key={i} className={styles.muted}>
                {downgrade.target} — {t('scans.wizard.review.matchedHeuristic')}:{' '}
                {downgrade.deviceClass}
              </p>
            ))}
          </div>

          <div>
            <h3 className={styles.sectionTitle}>{t('scans.wizard.review.pacing')}</h3>
            <p className={styles.muted}>
              {t('scans.wizard.review.pacingConfiguredVsCeiling', {
                configured: `${profile.pacing.packetsPerSecond} pps`,
                ceiling: `${ceilings.maxPacketsPerSecond} pps`,
              })}
            </p>
            <p className={styles.muted}>
              {t('scans.wizard.review.pacingConfiguredVsCeiling', {
                configured: `${profile.pacing.concurrentHosts} hosts`,
                ceiling: `${ceilings.maxConcurrentHosts} hosts`,
              })}
            </p>
          </div>
        </Stack>
      )}

      <div className={styles.footer}>
        <Button variant="secondary" onClick={onBack}>
          {t('common.back')}
        </Button>
        <Button
          variant="primary"
          disabled={isComputing || runMutation.isPending}
          onClick={() =>
            plan &&
            runMutation.mutate(
              { planPreviewId: plan.id, standardProfileConfirmationText },
              { onSuccess: (run) => onStarted(run.id) },
            )
          }
        >
          {t('scans.wizard.review.start')}
        </Button>
      </div>
    </Stack>
  );
}
