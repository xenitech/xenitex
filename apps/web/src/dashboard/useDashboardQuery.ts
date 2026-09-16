import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../api/client.js';
import { unwrap } from '../api/error.js';

export function useDashboardQuery() {
  return useQuery({
    queryKey: ['dashboard'],
    queryFn: async () => unwrap(await apiClient.GET('/dashboard')),
    staleTime: 30_000,
  });
}
