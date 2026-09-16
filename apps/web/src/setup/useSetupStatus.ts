import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../api/client.js';
import { unwrap } from '../api/error.js';

export const SETUP_STATUS_QUERY_KEY = ['setup', 'status'] as const;

/** Public endpoint (security: [] in the spec) — must be reachable before any session exists. */
export function useSetupStatus() {
  return useQuery({
    queryKey: SETUP_STATUS_QUERY_KEY,
    queryFn: async () => unwrap(await apiClient.GET('/setup/status')),
    staleTime: 0,
  });
}
