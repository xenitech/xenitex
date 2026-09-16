import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../api/client.js';
import { compact } from '../api/compact.js';
import { unwrap } from '../api/error.js';
import { newIdempotencyKey } from '../api/idempotency.js';
import type { Exception } from '../api/types.js';

export function useExceptionsQuery(status?: Exception['status']) {
  return useInfiniteQuery({
    queryKey: ['exceptions', 'list', status],
    queryFn: async ({ pageParam }: { pageParam: string | undefined }) =>
      unwrap(
        await apiClient.GET('/exceptions', {
          params: { query: compact({ cursor: pageParam, limit: 100, status }) },
        }),
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });
}

export function useCreateExceptionMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { issueId: string; justification: string; expiresAt: string }) =>
      unwrap(
        await apiClient.POST('/exceptions', {
          params: { header: { 'Idempotency-Key': newIdempotencyKey() } },
          body: input,
        }),
      ),
    onSuccess: (_result, variables) => {
      void queryClient.invalidateQueries({ queryKey: ['exceptions'] });
      void queryClient.invalidateQueries({ queryKey: ['issues', 'detail', variables.issueId] });
    },
  });
}

function useExceptionStatusMutation(action: 'approve' | 'reject' | 'revoke') {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (exceptionId: string) =>
      unwrap(
        await (action === 'approve'
          ? apiClient.POST('/exceptions/{exceptionId}/approve', {
              params: { path: { exceptionId } },
            })
          : action === 'reject'
            ? apiClient.POST('/exceptions/{exceptionId}/reject', {
                params: { path: { exceptionId } },
              })
            : apiClient.POST('/exceptions/{exceptionId}/revoke', {
                params: { path: { exceptionId } },
              })),
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['exceptions'] });
      void queryClient.invalidateQueries({ queryKey: ['issues'] });
    },
  });
}

export const useApproveExceptionMutation = () => useExceptionStatusMutation('approve');
export const useRejectExceptionMutation = () => useExceptionStatusMutation('reject');
export const useRevokeExceptionMutation = () => useExceptionStatusMutation('revoke');
