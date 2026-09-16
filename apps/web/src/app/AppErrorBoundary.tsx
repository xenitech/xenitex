import { Component, type ErrorInfo, type ReactNode } from 'react';
import { ApiError } from '../api/error.js';
import { ErrorState } from '../components/ErrorState/ErrorState.js';

interface Props {
  readonly children: ReactNode;
}

interface State {
  readonly error: Error | undefined;
}

/**
 * The one top-level boundary the whole app renders inside. Without this, an
 * error a query intentionally rethrows during render (e.g. SessionContext's
 * `throwOnError` for anything other than a clean 401 — a malformed response
 * from a not-yet-fully-implemented backend, a 500, a network failure)
 * unmounts the entire React tree to a blank page instead of a message a
 * user can act on. Found by pointing the built app at the real (Step 4
 * work-in-progress) API instead of the mock server.
 */
export class AppErrorBoundary extends Component<Props, State> {
  override state: State = { error: undefined };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Unhandled render error', error, info.componentStack);
  }

  override render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    const apiError = error instanceof ApiError ? error : undefined;
    return (
      <div style={{ padding: 'var(--space-9)' }}>
        <ErrorState
          title="Something went wrong"
          detail={apiError?.detail ?? error.message}
          code={apiError?.code ?? 'unknown'}
          correlationId={apiError?.correlationId ?? 'unavailable'}
        />
      </div>
    );
  }
}
