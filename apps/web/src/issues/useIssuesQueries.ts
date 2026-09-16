import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../api/client.js';
import { compact } from '../api/compact.js';
import { unwrap, unwrapWithETag } from '../api/error.js';
import { newIdempotencyKey } from '../api/idempotency.js';
import type { IssueState } from '../api/types.js';

export interface IssueFilters {
  readonly state: readonly IssueState[];
  readonly confidenceFloor: number;
  readonly minRiskScore: number | undefined;
  readonly overdue: boolean;
  readonly assetId: string | undefined;
  readonly sort: 'riskScore' | 'dueDate' | 'firstSeen' | 'lastSeen';
}

export const DEFAULT_ISSUE_FILTERS: IssueFilters = {
  state: [],
  confidenceFloor: 0.4,
  minRiskScore: undefined,
  overdue: false,
  assetId: undefined,
  sort: 'riskScore',
};

export function issuesQueryKey(filters: IssueFilters) {
  return ['issues', 'list', filters] as const;
}

export function useIssuesQuery(filters: IssueFilters) {
  return useInfiniteQuery({
    queryKey: issuesQueryKey(filters),
    queryFn: async ({ pageParam }: { pageParam: string | undefined }) =>
      unwrap(
        await apiClient.GET('/issues', {
          params: {
            query: compact({
              cursor: pageParam,
              limit: 100,
              state: filters.state.length ? [...filters.state] : undefined,
              confidenceFloor: filters.confidenceFloor,
              minRiskScore: filters.minRiskScore,
              overdue: filters.overdue || undefined,
              assetId: filters.assetId,
              sort: filters.sort,
            }),
          },
        }),
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });
}

export function useIssueDetailQuery(issueId: string | undefined) {
  return useQuery({
    queryKey: ['issues', 'detail', issueId],
    queryFn: async () =>
      unwrapWithETag(
        await apiClient.GET('/issues/{issueId}', { params: { path: { issueId: issueId! } } }),
      ),
    enabled: Boolean(issueId),
  });
}

export function useIssueHistoryQuery(issueId: string | undefined) {
  return useQuery({
    queryKey: ['issues', 'history', issueId],
    queryFn: async () =>
      unwrap(
        await apiClient.GET('/issues/{issueId}/history', {
          params: { path: { issueId: issueId! } },
        }),
      ),
    enabled: Boolean(issueId),
  });
}

export type ManualIssueState =
  'triaged' | 'in_progress' | 'mitigated' | 'reopened' | 'false_positive' | 'risk_accepted';

export interface TransitionInput {
  readonly issueId: string;
  readonly etag: string;
  readonly toState: ManualIssueState;
  readonly reasonCode?: string | undefined;
  readonly justification?: string | undefined;
}

export function useIssueTransitionMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ issueId, etag, toState, reasonCode, justification }: TransitionInput) =>
      unwrapWithETag(
        await apiClient.POST('/issues/{issueId}/transitions', {
          params: { path: { issueId }, header: { 'If-Match': etag } },
          body: { toState, ...compact({ reasonCode, justification }) },
        }),
      ),
    onSuccess: (_result, variables) => {
      void queryClient.invalidateQueries({ queryKey: ['issues'] });
      void queryClient.invalidateQueries({ queryKey: ['issues', 'history', variables.issueId] });
    },
  });
}

export function useCreateVerificationScanMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (issueId: string) =>
      unwrap(
        await apiClient.POST('/verification-scans', {
          params: { header: { 'Idempotency-Key': newIdempotencyKey() } },
          body: { issueId },
        }),
      ),
    onSuccess: (_result, issueId) => {
      void queryClient.invalidateQueries({ queryKey: ['issues', 'detail', issueId] });
    },
  });
}

export function useSavedViewsQuery() {
  return useQuery({
    queryKey: ['saved-views'],
    queryFn: async () => unwrap(await apiClient.GET('/saved-views')),
  });
}

export function useCreateSavedViewMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { name: string; query: string; isShared: boolean }) =>
      unwrap(
        await apiClient.POST('/saved-views', {
          params: { header: { 'Idempotency-Key': newIdempotencyKey() } },
          body: input,
        }),
      ),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['saved-views'] }),
  });
}

export { flattenPages } from '../api/pagination.js';
