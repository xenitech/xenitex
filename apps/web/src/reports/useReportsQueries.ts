import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../api/client.js';
import { compact } from '../api/compact.js';
import { unwrap } from '../api/error.js';
import { newIdempotencyKey } from '../api/idempotency.js';
import type { ReportTemplate } from '../api/types.js';

export function useReportsQuery() {
  return useInfiniteQuery({
    queryKey: ['reports', 'list'],
    queryFn: async ({ pageParam }: { pageParam: string | undefined }) =>
      unwrap(
        await apiClient.GET('/reports', {
          params: { query: compact({ cursor: pageParam, limit: 100 }) },
        }),
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    // A pending report becomes completed shortly after generation — poll while any page has a pending item.
    refetchInterval: (query) =>
      query.state.data?.pages.some((p) => p.items.some((r) => r.status === 'pending'))
        ? 2000
        : false,
  });
}

export function useCreateReportMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      template: ReportTemplate;
      formats: ('html' | 'csv' | 'json')[];
      dateRangeStart?: string;
      dateRangeEnd?: string;
    }) =>
      unwrap(
        await apiClient.POST('/reports', {
          params: { header: { 'Idempotency-Key': newIdempotencyKey() } },
          body: { ...input, scopeFilter: {} },
        }),
      ),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['reports'] }),
  });
}
