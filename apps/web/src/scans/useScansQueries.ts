import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../api/client.js';
import { compact } from '../api/compact.js';
import { unwrap } from '../api/error.js';
import { newIdempotencyKey } from '../api/idempotency.js';

export { useAuthorizedScopesQuery, useScanProfilesQuery } from '../scope/useScopeQueries.js';

export function useCreateScanPlanMutation() {
  return useMutation({
    mutationFn: async (input: { scopeId: string; profileId: string }) =>
      unwrap(
        await apiClient.POST('/scan-plans', {
          params: { header: { 'Idempotency-Key': newIdempotencyKey() } },
          body: input,
        }),
      ),
  });
}

export function useCreateScanRunMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      planPreviewId: string;
      standardProfileConfirmationText?: string | undefined;
    }) =>
      unwrap(
        await apiClient.POST('/scan-runs', {
          params: { header: { 'Idempotency-Key': newIdempotencyKey() } },
          body: {
            planPreviewId: input.planPreviewId,
            confirm: true as const,
            ...compact({ standardProfileConfirmationText: input.standardProfileConfirmationText }),
          },
        }),
      ),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['scan-runs'] }),
  });
}

export function useScanRunsQuery() {
  return useInfiniteQuery({
    queryKey: ['scan-runs', 'list'],
    queryFn: async ({ pageParam }: { pageParam: string | undefined }) =>
      unwrap(
        await apiClient.GET('/scan-runs', {
          params: { query: compact({ cursor: pageParam, limit: 100 }) },
        }),
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });
}

const ACTIVE_STATUSES = new Set(['queued', 'running', 'paused']);

export function useScanRunQuery(scanRunId: string | undefined) {
  return useQuery({
    queryKey: ['scan-runs', 'detail', scanRunId],
    queryFn: async () =>
      unwrap(
        await apiClient.GET('/scan-runs/{scanRunId}', {
          params: { path: { scanRunId: scanRunId! } },
        }),
      ),
    enabled: Boolean(scanRunId),
    // SAFE-08/P1-10: a live run view polls while queued/running/paused, stops once terminal.
    refetchInterval: (query) =>
      query.state.data && ACTIVE_STATUSES.has(query.state.data.status) ? 2000 : false,
  });
}

export function useScanRunTargetsQuery(scanRunId: string | undefined) {
  return useQuery({
    queryKey: ['scan-runs', 'targets', scanRunId],
    queryFn: async () =>
      unwrap(
        await apiClient.GET('/scan-runs/{scanRunId}/targets', {
          params: { path: { scanRunId: scanRunId! }, query: { limit: 500 } },
        }),
      ),
    enabled: Boolean(scanRunId),
    refetchInterval: 3000,
  });
}

export function useScanRunRawArtifactsQuery(scanRunId: string | undefined) {
  return useQuery({
    queryKey: ['scan-runs', 'raw-artifacts', scanRunId],
    queryFn: async () =>
      unwrap(
        await apiClient.GET('/scan-runs/{scanRunId}/raw-artifacts', {
          params: { path: { scanRunId: scanRunId! } },
        }),
      ),
    enabled: Boolean(scanRunId),
  });
}

function useScanRunAction(action: 'pause' | 'resume' | 'abort') {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { scanRunId: string; reason?: string }) =>
      unwrap(
        await (action === 'pause'
          ? apiClient.POST('/scan-runs/{scanRunId}/pause', {
              params: { path: { scanRunId: input.scanRunId } },
            })
          : action === 'resume'
            ? apiClient.POST('/scan-runs/{scanRunId}/resume', {
                params: { path: { scanRunId: input.scanRunId } },
              })
            : apiClient.POST('/scan-runs/{scanRunId}/abort', {
                params: { path: { scanRunId: input.scanRunId } },
                body: compact({ reason: input.reason }),
              })),
      ),
    onSuccess: (_result, variables) => {
      void queryClient.invalidateQueries({
        queryKey: ['scan-runs', 'detail', variables.scanRunId],
      });
      void queryClient.invalidateQueries({ queryKey: ['scan-runs', 'list'] });
    },
  });
}

export const usePauseScanRunMutation = () => useScanRunAction('pause');
export const useResumeScanRunMutation = () => useScanRunAction('resume');
export const useAbortScanRunMutation = () => useScanRunAction('abort');
