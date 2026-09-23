import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RiskBadge } from '../components/RiskBadge/RiskBadge.js';
import { RiskExplainer } from '../components/RiskExplainer/RiskExplainer.js';
import { StateChip } from '../components/StateChip/StateChip.js';
import { EvidenceBlock } from '../components/EvidenceBlock/EvidenceBlock.js';
import { EmptyState } from '../components/EmptyState/EmptyState.js';
import { ErrorState } from '../components/ErrorState/ErrorState.js';
import { SkeletonRow } from '../components/SkeletonRow/SkeletonRow.js';
import { Button } from '../components/form/Button.js';
import { Stack } from '../components/layout/Stack.js';
import { ApiError } from '../api/error.js';
import { useSession } from '../auth/SessionContext.js';
import {
  useCreateVerificationScanMutation,
  useIssueDetailQuery,
  useIssueHistoryQuery,
  useIssueTransitionMutation,
} from './useIssuesQueries.js';
import { useCreateExceptionMutation } from '../exceptions/useExceptionQueries.js';
import { FalsePositiveDialog } from './dialogs/FalsePositiveDialog.js';
import { RiskAcceptDialog } from './dialogs/RiskAcceptDialog.js';
import styles from './IssueDetailPanel.module.css';

type Tab = 'overview' | 'evidence' | 'history';

export function IssueDetailPanel({ issueId }: { readonly issueId: string }) {
  const { t } = useTranslation();
  const { hasCapability } = useSession();
  const [tab, setTab] = useState<Tab>('overview');
  const [dialog, setDialog] = useState<'false-positive' | 'risk-accept' | undefined>(undefined);

  const { data, isLoading, isError, error } = useIssueDetailQuery(issueId);
  const historyQuery = useIssueHistoryQuery(tab === 'history' ? issueId : undefined);
  const transition = useIssueTransitionMutation();
  const verify = useCreateVerificationScanMutation();
  const createException = useCreateExceptionMutation();

  if (isLoading) {
    return (
      <div className={styles.panel}>
        <SkeletonRow columnWidths={[1]} />
        <SkeletonRow columnWidths={[1]} />
        <SkeletonRow columnWidths={[1]} />
      </div>
    );
  }

  if (isError || !data) {
    const apiErr = error instanceof ApiError ? error : undefined;
    return (
      <ErrorState
        title={t('components.errorState.title')}
        detail={apiErr?.detail ?? ''}
        code={apiErr?.code ?? 'unknown'}
        correlationId={apiErr?.correlationId ?? 'unavailable'}
      />
    );
  }

  const { data: issue, etag } = data;
  const canWrite = hasCapability('issues.write');

  const doTransition = (toState: 'triaged' | 'in_progress' | 'mitigated' | 'reopened') => {
    if (!etag) return;
    transition.mutate({ issueId, etag, toState });
  };

  return (
    <div className={styles.panel}>
      <h2 className={styles.title}>{issue.title ?? t('common.unknown')}</h2>
      <div className={styles.tabs} role="tablist">
        {(['overview', 'evidence', 'history'] as const).map((key) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            className={tab === key ? styles.tabActive : styles.tab}
            onClick={() => setTab(key)}
          >
            {t(`issues.detail.tabs.${key}`)}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <Stack className={styles.tabPanel}>
          <div className={styles.riskRow}>
            <RiskBadge score={Math.round(issue.riskScore)} band={issue.severity} />
            <StateChip state={issue.state} />
          </div>
          {issue.vulnerability?.description && <p>{issue.vulnerability.description}</p>}

          <div>
            <h3 className={styles.sectionTitle}>{t('assets.title')}</h3>
            <p>
              {issue.asset.hostnames.find((h) => h.isCurrent)?.hostnameUntrusted ??
                issue.asset.addresses[0]?.address}
            </p>
            <p className={styles.muted}>
              {t('assets.columns.criticality')}:{' '}
              {t(`common.criticality.${issue.asset.businessCriticality}`)} ·{' '}
              {t('assets.columns.exposure')}:{' '}
              {t(`common.exposure.${issue.asset.exposureClassification}`)}
            </p>
          </div>

          {issue.matchExplanation && (
            <div>
              <h3 className={styles.sectionTitle}>{t('issues.detail.whyMatched')}</h3>
              {/* MOD-20/QA-00: a possible backport is called out distinctly
                  rather than being folded in with confirmed matches. The
                  whole point of carrying match reasons through is that a
                  reviewer can see WHY the confidence is what it is instead
                  of being handed a number to trust. */}
              {issue.matchReasons?.includes('vendor_revision_backport_possible') && (
                <p className={styles.backportWarning}>{t('issues.detail.backportWarning')}</p>
              )}
              <p className={styles.muted}>{issue.matchExplanation}</p>
            </div>
          )}

          <div>
            <h3 className={styles.sectionTitle}>
              {t('components.riskExplainer.version', { version: issue.riskScorePolicyVersion })}
            </h3>
            <RiskExplainer
              factors={issue.riskScoreBreakdown}
              scoringPolicyVersion={issue.riskScorePolicyVersion}
            />
          </div>

          <div>
            <h3 className={styles.sectionTitle}>{t('issues.detail.remediation')}</h3>
            {issue.remediationGuidance ? (
              <>
                <p>{issue.remediationGuidance.priorityRationale}</p>
                <p>{issue.remediationGuidance.remediationSteps}</p>
              </>
            ) : (
              <p className={styles.muted}>{t('issues.detail.noRemediation')}</p>
            )}
          </div>

          <p className={styles.muted}>
            {t('issues.detail.owner')}: {issue.ownerUserId ?? t('issues.detail.unassigned')} ·{' '}
            {t('issues.detail.dueDate')}: {issue.dueDate ?? '—'}
          </p>

          {canWrite && (
            <div className={styles.actions}>
              <LifecycleActions
                state={issue.state}
                onTransition={doTransition}
                onVerify={() => verify.mutate(issueId)}
                onFalsePositive={() => setDialog('false-positive')}
                onRiskAccept={() => setDialog('risk-accept')}
              />
            </div>
          )}
        </Stack>
      )}

      {tab === 'evidence' && (
        <Stack className={styles.tabPanel}>
          {issue.observations.length === 0 ? (
            <EmptyState
              title={t('issues.detail.tabs.evidence')}
              description={t('issues.detail.noRemediation')}
            />
          ) : (
            <p className={styles.muted}>
              {t('issues.detail.evidenceCount', { count: issue.observations.length })}
            </p>
          )}
          {issue.observations.map((observation) => (
            <EvidenceBlock
              key={observation.id}
              adapterKey={observation.scannerAdapterKey}
              adapterVersion={observation.scannerAdapterVersion}
              observedAt={observation.observedAt}
              rawArtifactHref={`/v1/raw-artifacts/${observation.rawArtifactId}/download`}
              lines={Object.entries(observation.untrustedEvidence)
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([key, value]) => `${key}: ${value}`)}
            />
          ))}
        </Stack>
      )}

      {tab === 'history' && (
        <Stack className={styles.tabPanel}>
          {historyQuery.data?.items.length === 0 && (
            <EmptyState title={t('issues.detail.tabs.history')} description="" />
          )}
          {historyQuery.data?.items.map((entry) => (
            <div key={entry.id} className={styles.historyEntry}>
              <StateChip state={entry.toState} />
              <span className={styles.muted}>{entry.transitionedAt}</span>
              {entry.justification && <p>{entry.justification}</p>}
            </div>
          ))}
        </Stack>
      )}

      <FalsePositiveDialog
        isOpen={dialog === 'false-positive'}
        onClose={() => setDialog(undefined)}
        isSubmitting={transition.isPending}
        onSubmit={(input) => {
          if (!etag) return;
          transition.mutate(
            { issueId, etag, toState: 'false_positive', ...input },
            { onSuccess: () => setDialog(undefined) },
          );
        }}
      />
      <RiskAcceptDialog
        isOpen={dialog === 'risk-accept'}
        onClose={() => setDialog(undefined)}
        isSubmitting={createException.isPending}
        onSubmit={(input) =>
          createException.mutate({ issueId, ...input }, { onSuccess: () => setDialog(undefined) })
        }
      />
    </div>
  );
}

function LifecycleActions({
  state,
  onTransition,
  onVerify,
  onFalsePositive,
  onRiskAccept,
}: {
  readonly state: string;
  readonly onTransition: (toState: 'triaged' | 'in_progress' | 'mitigated' | 'reopened') => void;
  readonly onVerify: () => void;
  readonly onFalsePositive: () => void;
  readonly onRiskAccept: () => void;
}) {
  const { t } = useTranslation();
  switch (state) {
    case 'new':
    case 'reopened':
      return (
        <>
          <Button variant="primary" onClick={() => onTransition('triaged')}>
            {t('issues.detail.lifecycle.triage')}
          </Button>
          <Button variant="danger" onClick={onFalsePositive}>
            {t('issues.detail.lifecycle.falsePositive')}
          </Button>
          <Button variant="secondary" onClick={onRiskAccept}>
            {t('issues.detail.lifecycle.riskAccept')}
          </Button>
        </>
      );
    case 'triaged':
      return (
        <>
          <Button variant="primary" onClick={() => onTransition('in_progress')}>
            {t('issues.detail.lifecycle.inProgress')}
          </Button>
          <Button variant="danger" onClick={onFalsePositive}>
            {t('issues.detail.lifecycle.falsePositive')}
          </Button>
          <Button variant="secondary" onClick={onRiskAccept}>
            {t('issues.detail.lifecycle.riskAccept')}
          </Button>
        </>
      );
    case 'in_progress':
      return (
        <>
          <Button variant="primary" onClick={() => onTransition('mitigated')}>
            {t('issues.detail.lifecycle.mitigated')}
          </Button>
          <Button variant="danger" onClick={onFalsePositive}>
            {t('issues.detail.lifecycle.falsePositive')}
          </Button>
          <Button variant="secondary" onClick={onRiskAccept}>
            {t('issues.detail.lifecycle.riskAccept')}
          </Button>
        </>
      );
    case 'mitigated':
      return (
        <>
          <Button variant="primary" onClick={onVerify}>
            {t('issues.detail.lifecycle.verify')}
          </Button>
          <Button variant="secondary" onClick={() => onTransition('reopened')}>
            {t('issues.detail.lifecycle.reopen')}
          </Button>
        </>
      );
    case 'false_positive':
    case 'verified_resolved':
      return (
        <Button variant="secondary" onClick={() => onTransition('reopened')}>
          {t('issues.detail.lifecycle.reopen')}
        </Button>
      );
    default:
      return null;
  }
}
