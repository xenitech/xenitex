import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../api/client.js';
import { compact } from '../api/compact.js';
import { unwrap, unwrapWithETag } from '../api/error.js';
import { newIdempotencyKey } from '../api/idempotency.js';
import type { AttestationType, ExclusionRuleType, IntrusivenessProfile } from '../api/types.js';

export function useAuthorizedScopesQuery() {
  return useQuery({
    queryKey: ['authorized-scopes'],
    queryFn: async () =>
      unwrap(await apiClient.GET('/authorized-scopes', { params: { query: { limit: 100 } } })),
  });
}

export function useCreateAuthorizedScopeMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      name: string;
      cidrRanges: string[];
      hostnames: string[];
      attestationType: AttestationType;
      attestationDetails: string;
    }) =>
      unwrap(
        await apiClient.POST('/authorized-scopes', {
          params: { header: { 'Idempotency-Key': newIdempotencyKey() } },
          body: input,
        }),
      ),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['authorized-scopes'] }),
  });
}

/** SAFE-01: scopes are immutable once accepted — "editing" one declares a new scope (fresh attestation) that supersedes it; the old record's fields never change. */
export function useSupersedeAuthorizedScopeMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      scopeId: string;
      name: string;
      cidrRanges: string[];
      hostnames: string[];
      attestationType: AttestationType;
      attestationDetails: string;
    }) =>
      unwrap(
        await apiClient.POST('/authorized-scopes/{scopeId}/supersede', {
          params: {
            path: { scopeId: input.scopeId },
            header: { 'Idempotency-Key': newIdempotencyKey() },
          },
          body: {
            name: input.name,
            cidrRanges: input.cidrRanges,
            hostnames: input.hostnames,
            attestationType: input.attestationType,
            attestationDetails: input.attestationDetails,
          },
        }),
      ),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['authorized-scopes'] }),
  });
}

export function useExclusionRulesQuery(scopeId?: string) {
  return useQuery({
    queryKey: ['exclusion-rules', 'all', scopeId],
    queryFn: async () =>
      unwrap(
        await apiClient.GET('/exclusion-rules', {
          params: { query: compact({ scopeId, limit: 200 }) },
        }),
      ),
  });
}

export function useCreateExclusionRuleMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      scopeId: string | null;
      ruleType: ExclusionRuleType;
      value: string;
      reason: string;
    }) =>
      unwrap(
        await apiClient.POST('/exclusion-rules', {
          params: { header: { 'Idempotency-Key': newIdempotencyKey() } },
          body: input,
        }),
      ),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['exclusion-rules'] }),
  });
}

/** SAFE-02: value/ruleType/reason are immutable (audit trail) — this is the only mutation the API allows on an existing rule. */
export function useSetExclusionRuleActiveMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { ruleId: string; isActive: boolean }) => {
      // ADR 0006: the list endpoint carries no per-item ETag — fetch the
      // single-resource GET immediately before mutating to get a current one.
      const { etag } = unwrapWithETag(
        await apiClient.GET('/exclusion-rules/{ruleId}', {
          params: { path: { ruleId: input.ruleId } },
        }),
      );
      return unwrap(
        await apiClient.PATCH('/exclusion-rules/{ruleId}', {
          params: { path: { ruleId: input.ruleId }, header: { 'If-Match': etag ?? '' } },
          body: { isActive: input.isActive },
        }),
      );
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['exclusion-rules'] }),
  });
}

export function useScanProfilesQuery() {
  return useQuery({
    queryKey: ['scan-profiles'],
    queryFn: async () => unwrap(await apiClient.GET('/scan-profiles')),
  });
}

export function useCreateScanProfileMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      name: string;
      intrusiveness: 'passive-inventory' | 'safe' | 'standard';
      pacing: {
        packetsPerSecond: number;
        concurrentHosts: number;
        concurrentPortsPerHost: number;
        timeoutMs: number;
        retries: number;
      };
    }) =>
      unwrap(
        await apiClient.POST('/scan-profiles', {
          params: { header: { 'Idempotency-Key': newIdempotencyKey() } },
          body: input,
        }),
      ),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['scan-profiles'] }),
  });
}

export function useUpdateScanProfileMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      profileId: string;
      name: string;
      intrusiveness: IntrusivenessProfile;
      pacing: {
        packetsPerSecond: number;
        concurrentHosts: number;
        concurrentPortsPerHost: number;
        timeoutMs: number;
        retries: number;
      };
    }) => {
      // ADR 0006: the list endpoint carries no per-item ETag — fetch the
      // single-resource GET immediately before mutating to get a current one.
      const { etag } = unwrapWithETag(
        await apiClient.GET('/scan-profiles/{profileId}', {
          params: { path: { profileId: input.profileId } },
        }),
      );
      return unwrap(
        await apiClient.PATCH('/scan-profiles/{profileId}', {
          params: { path: { profileId: input.profileId }, header: { 'If-Match': etag ?? '' } },
          body: { name: input.name, intrusiveness: input.intrusiveness, pacing: input.pacing },
        }),
      );
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['scan-profiles'] }),
  });
}

export function useBlackoutWindowsQuery(scopeId?: string) {
  return useQuery({
    queryKey: ['blackout-windows', scopeId],
    queryFn: async () =>
      unwrap(await apiClient.GET('/blackout-windows', { params: { query: compact({ scopeId }) } })),
  });
}

export function useCreateBlackoutWindowMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      scopeId: string | null;
      name: string;
      timezone: string;
      startsAt: string;
      endsAt: string;
      isRecurring: boolean;
    }) =>
      unwrap(
        await apiClient.POST('/blackout-windows', {
          params: { header: { 'Idempotency-Key': newIdempotencyKey() } },
          body: input,
        }),
      ),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['blackout-windows'] }),
  });
}

export function useScanSchedulesQuery() {
  return useQuery({
    queryKey: ['scan-schedules'],
    queryFn: async () =>
      unwrap(await apiClient.GET('/scan-schedules', { params: { query: { limit: 100 } } })),
  });
}
