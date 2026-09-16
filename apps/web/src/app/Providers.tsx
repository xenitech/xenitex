import { QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { I18nextProvider } from 'react-i18next';
import { queryClient } from '../api/queryClient.js';
import { i18next } from '../i18n/index.js';
import { SessionProvider } from '../auth/SessionContext.js';
import { ThemeProvider } from '../theme/ThemeContext.js';
import { AppErrorBoundary } from './AppErrorBoundary.js';

/**
 * Every provider the app needs, in the order their dependencies require
 * (query client before session, since session is a query). The error
 * boundary sits outside `SessionProvider` deliberately — `SessionProvider`
 * itself can rethrow during render (see AppErrorBoundary's comment), so the
 * boundary has to enclose it, not just the children below it.
 */
export function Providers({ children }: { readonly children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <I18nextProvider i18n={i18next}>
        <ThemeProvider>
          <AppErrorBoundary>
            <SessionProvider>{children}</SessionProvider>
          </AppErrorBoundary>
        </ThemeProvider>
      </I18nextProvider>
    </QueryClientProvider>
  );
}
