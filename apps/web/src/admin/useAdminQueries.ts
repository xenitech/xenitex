import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../api/client.js';
import { compact } from '../api/compact.js';
import { unwrap, unwrapWithETag } from '../api/error.js';
import { newIdempotencyKey } from '../api/idempotency.js';
import type { NotificationChannelType, RetentionDataClass, UserRole } from '../api/types.js';

// --- Users ---
export function useUsersQuery() {
  return useInfiniteQuery({
    queryKey: ['users', 'list'],
    queryFn: async ({ pageParam }: { pageParam: string | undefined }) =>
      unwrap(
        await apiClient.GET('/users', {
          params: { query: compact({ cursor: pageParam, limit: 100 }) },
        }),
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });
}

export function useCreateUserMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      email: string;
      displayName: string;
      role: UserRole;
      password: string;
    }) =>
      unwrap(
        await apiClient.POST('/users', {
          params: { header: { 'Idempotency-Key': newIdempotencyKey() } },
          body: input,
        }),
      ),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['users'] }),
  });
}

export function useDeactivateUserMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (userId: string) =>
      unwrap(await apiClient.POST('/users/{userId}/deactivate', { params: { path: { userId } } })),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['users'] }),
  });
}

// --- Notification channels ---
export function useNotificationChannelsQuery() {
  return useQuery({
    queryKey: ['notification-channels'],
    queryFn: async () => unwrap(await apiClient.GET('/notification-channels')),
  });
}

export function useCreateNotificationChannelMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      type: NotificationChannelType;
      config: Record<string, unknown>;
      isEnabled: boolean;
    }) =>
      unwrap(
        await apiClient.POST('/notification-channels', {
          params: { header: { 'Idempotency-Key': newIdempotencyKey() } },
          body: input,
        }),
      ),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['notification-channels'] }),
  });
}

// --- Feature flags ---
export function useFeatureFlagsQuery() {
  return useQuery({
    queryKey: ['feature-flags'],
    queryFn: async () => unwrap(await apiClient.GET('/feature-flags')),
  });
}

export function useUpdateFeatureFlagMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { key: string; isEnabled: boolean }) =>
      unwrap(
        await apiClient.PATCH('/feature-flags/{key}', {
          params: { path: { key: input.key } },
          body: { isEnabled: input.isEnabled },
        }),
      ),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['feature-flags'] }),
  });
}

// --- Retention ---
export function useRetentionPoliciesQuery() {
  return useQuery({
    queryKey: ['retention-policies'],
    queryFn: async () => unwrap(await apiClient.GET('/retention-policies')),
  });
}

export function useUpdateRetentionPolicyMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { dataClass: RetentionDataClass; retentionDays: number }) => {
      // ADR 0006: PATCH requires If-Match, and the list endpoint carries no
      // per-item ETag — fetch the single-resource GET immediately before
      // mutating to get a current one.
      const { etag } = unwrapWithETag(
        await apiClient.GET('/retention-policies/{dataClass}', {
          params: { path: { dataClass: input.dataClass } },
        }),
      );
      return unwrap(
        await apiClient.PATCH('/retention-policies/{dataClass}', {
          params: { path: { dataClass: input.dataClass }, header: { 'If-Match': etag ?? '' } },
          body: { retentionDays: input.retentionDays },
        }),
      );
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['retention-policies'] }),
  });
}

// --- Backup ---
export function useBackupRecordsQuery() {
  return useInfiniteQuery({
    queryKey: ['backup-records'],
    queryFn: async ({ pageParam }: { pageParam: string | undefined }) =>
      unwrap(
        await apiClient.GET('/backup-records', {
          params: { query: compact({ cursor: pageParam, limit: 50 }) },
        }),
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });
}

export function useCreateBackupMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () =>
      unwrap(
        await apiClient.POST('/backups', {
          params: { header: { 'Idempotency-Key': newIdempotencyKey() } },
        }),
      ),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['backup-records'] }),
  });
}

// --- Audit ---
export function useAuditEntriesQuery() {
  return useInfiniteQuery({
    queryKey: ['audit-entries'],
    queryFn: async ({ pageParam }: { pageParam: string | undefined }) =>
      unwrap(
        await apiClient.GET('/audit-entries', {
          params: { query: compact({ cursor: pageParam, limit: 100 }) },
        }),
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });
}

export function useVerifyAuditChainQuery() {
  return useQuery({
    queryKey: ['audit-chain', 'verify'],
    queryFn: async () => unwrap(await apiClient.GET('/audit-chain/verify')),
    enabled: false,
  });
}

// --- System health ---
export function useSystemHealthQuery() {
  return useQuery({
    queryKey: ['system-health'],
    queryFn: async () => unwrap(await apiClient.GET('/system-health')),
    refetchInterval: 15_000,
  });
}
