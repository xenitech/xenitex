import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../api/client.js';
import { compact } from '../api/compact.js';
import { unwrap, unwrapWithETag } from '../api/error.js';
import { newIdempotencyKey } from '../api/idempotency.js';
import type { AssetCriticality, ExposureClassification } from '../api/types.js';

export { flattenPages } from '../api/pagination.js';

export interface AssetFilters {
  readonly criticality: AssetCriticality | undefined;
  readonly exposure: ExposureClassification | undefined;
  readonly isFragile: boolean | undefined;
  readonly q: string | undefined;
}

export const DEFAULT_ASSET_FILTERS: AssetFilters = {
  criticality: undefined,
  exposure: undefined,
  isFragile: undefined,
  q: undefined,
};

export function useAssetsQuery(filters: AssetFilters) {
  return useInfiniteQuery({
    queryKey: ['assets', 'list', filters],
    queryFn: async ({ pageParam }: { pageParam: string | undefined }) =>
      unwrap(
        await apiClient.GET('/assets', {
          params: { query: compact({ cursor: pageParam, limit: 100, ...filters }) },
        }),
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });
}

export function useAssetDetailQuery(assetId: string | undefined) {
  return useQuery({
    queryKey: ['assets', 'detail', assetId],
    queryFn: async () =>
      unwrapWithETag(
        await apiClient.GET('/assets/{assetId}', { params: { path: { assetId: assetId! } } }),
      ),
    enabled: Boolean(assetId),
  });
}

export function useAssetIssuesQuery(assetId: string | undefined) {
  return useQuery({
    queryKey: ['assets', 'issues', assetId],
    queryFn: async () =>
      unwrap(
        await apiClient.GET('/assets/{assetId}/issues', {
          params: { path: { assetId: assetId! } },
        }),
      ),
    enabled: Boolean(assetId),
  });
}

export function useAssetScanHistoryQuery(assetId: string | undefined) {
  return useQuery({
    queryKey: ['assets', 'scan-history', assetId],
    queryFn: async () =>
      unwrap(
        await apiClient.GET('/assets/{assetId}/scan-history', {
          params: { path: { assetId: assetId! } },
        }),
      ),
    enabled: Boolean(assetId),
  });
}

export function useUpdateAssetMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      assetId: string;
      etag: string;
      ownerTeam?: string | null;
      businessCriticality?: AssetCriticality;
      tags?: string[];
    }) => {
      const { assetId, etag, ...body } = input;
      return unwrapWithETag(
        await apiClient.PATCH('/assets/{assetId}', {
          params: { path: { assetId }, header: { 'If-Match': etag } },
          body,
        }),
      );
    },
    onSuccess: (_result, variables) => {
      void queryClient.invalidateQueries({ queryKey: ['assets', 'detail', variables.assetId] });
      void queryClient.invalidateQueries({ queryKey: ['assets', 'list'] });
    },
  });
}

export function useAssetMergeCandidatesQuery() {
  return useInfiniteQuery({
    queryKey: ['assets', 'merge-candidates'],
    queryFn: async ({ pageParam }: { pageParam: string | undefined }) =>
      unwrap(
        await apiClient.GET('/asset-merge-candidates', {
          params: { query: compact({ cursor: pageParam, limit: 50 }) },
        }),
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });
}

export function useCreateAssetMergeMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { survivorAssetId: string; mergedAssetId: string }) =>
      unwrap(
        await apiClient.POST('/asset-merges', {
          params: { header: { 'Idempotency-Key': newIdempotencyKey() } },
          body: input,
        }),
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['assets'] });
    },
  });
}

export function useReverseAssetMergeMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { eventId: string; reason: string }) =>
      unwrap(
        await apiClient.POST('/asset-merge-events/{eventId}/reverse', {
          params: { path: { eventId: input.eventId } },
          body: { reason: input.reason },
        }),
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['assets'] });
    },
  });
}
