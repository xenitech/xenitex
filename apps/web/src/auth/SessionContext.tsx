import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { apiClient } from '../api/client.js';
import { ApiError, unwrap } from '../api/error.js';
import type { CurrentUser } from '../api/types.js';

export const SESSION_QUERY_KEY = ['auth', 'session'] as const;

async function fetchSession(): Promise<CurrentUser> {
  const result = await apiClient.GET('/auth/session');
  return unwrap(result);
}

interface SessionContextValue {
  readonly currentUser: CurrentUser | undefined;
  readonly isLoading: boolean;
  readonly isSignedIn: boolean;
  hasCapability(key: string): boolean;
  invalidate(): Promise<void>;
}

const SessionContext = createContext<SessionContextValue | undefined>(undefined);

/**
 * P1-23: fetches the server-computed capability payload once per session and
 * exposes `hasCapability` for permission-aware rendering. This is COSMETIC
 * ONLY (SEC-13) — every screen still assumes the API will independently
 * reject an unauthorized request; `hasCapability` exists to avoid showing a
 * control a user cannot use, not to gate the actual mutation.
 */
export function SessionProvider({ children }: { readonly children: ReactNode }) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: SESSION_QUERY_KEY,
    queryFn: fetchSession,
    retry: false,
    staleTime: 60_000,
    // A 401 here just means "not signed in" — not an error state to surface.
    throwOnError: (error) => !(error instanceof ApiError && error.status === 401),
  });

  const value = useMemo<SessionContextValue>(
    () => ({
      currentUser: query.data,
      isLoading: query.isLoading,
      isSignedIn: Boolean(query.data),
      hasCapability: (key) => query.data?.capabilities[key] === true,
      invalidate: () => queryClient.invalidateQueries({ queryKey: SESSION_QUERY_KEY }),
    }),
    [query.data, query.isLoading, queryClient],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used within SessionProvider');
  return ctx;
}
