import { QueryClient } from '@tanstack/react-query';
import { ApiError } from './error.js';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // A 401/403/404/409/422 will never succeed on retry; only transient
      // network/5xx failures are worth one retry (ADR 0006 problem codes
      // are stable enough to branch on here rather than guessing from status).
      retry: (failureCount, error) => {
        if (error instanceof ApiError && error.status < 500) return false;
        return failureCount < 2;
      },
      staleTime: 15_000,
    },
    mutations: {
      retry: false,
    },
  },
});
