import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../api/client.js';
import { compact } from '../api/compact.js';
import { unwrap, unwrapWithETag } from '../api/error.js';
import { newIdempotencyKey } from '../api/idempotency.js';

/** docs/cve-intel-feature-spec.md UI-103/UI-104. */
export function useIntelStatusQuery() {
  return useQuery({
    queryKey: ['intel-status'],
    queryFn: async () => unwrap(await apiClient.GET('/intel/status')),
    // A running sync updates fetched/added/etc only once it completes (no
    // per-page progress yet — see UI-107's JobProgress note in the tab
    // component) — a short poll is the honest way to reflect that.
    refetchInterval: (query) => (query.state.data?.lastSyncAttempt?.status === 'validating' ? 4000 : false),
  });
}

export function useIntelImportsQuery() {
  return useInfiniteQuery({
    queryKey: ['intel-imports'],
    queryFn: async ({ pageParam }: { pageParam: string | undefined }) =>
      unwrap(
        await apiClient.GET('/intel/imports', { params: { query: compact({ cursor: pageParam, limit: 20 }) } }),
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });
}

export function useCreateIntelSyncMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { modifiedSinceDays: number }) =>
      unwrap(
        await apiClient.POST('/intel/sync', {
          params: { header: { 'Idempotency-Key': newIdempotencyKey() } },
          body: input,
        }),
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['intel-status'] });
      void queryClient.invalidateQueries({ queryKey: ['intel-imports'] });
    },
  });
}

export function useSetIntelOnlineUpdatesDisabledMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (onlineUpdatesDisabled: boolean) => {
      // ADR 0006: the settings GET carries its own ETag already (no list to fall back to here).
      const { etag } = unwrapWithETag(await apiClient.GET('/intel/settings'));
      return unwrap(
        await apiClient.PATCH('/intel/settings', {
          params: { header: { 'If-Match': etag ?? '' } },
          body: { onlineUpdatesDisabled },
        }),
      );
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['intel-status'] }),
  });
}
