import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from './App.js';
import { queryClient } from './api/queryClient.js';

// api/queryClient.ts is a module-level singleton (shared across the whole
// app deliberately) — each test must clear its cache or the next test's
// render reuses the previous test's cached session/setup-status data.
afterEach(() => {
  queryClient.clear();
  vi.unstubAllGlobals();
});

const SETUP_COMPLETE = {
  administratorCreated: true,
  organizationConfigured: true,
  tlsConfigured: true,
  initialScopeDeclared: true,
  safetyAcknowledged: true,
  setupCompleted: true,
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** `fetch` is called with a `Request` object here (openapi-fetch constructs one) — `String(request)` is `"[object Request]"`, not its URL. */
function urlOf(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

describe('App', () => {
  it('shows the sign-in screen once setup is complete and no session exists', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = urlOf(input);
        if (url.includes('/setup/status')) return jsonResponse(SETUP_COMPLETE);
        if (url.includes('/auth/session'))
          return jsonResponse({ code: 'auth.session_required', title: 'x', status: 401 }, 401);
        return jsonResponse({}, 404);
      }),
    );

    render(<App />);

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: /sign in/i })).toBeInTheDocument(),
    );
  });

  it('shows the first-run setup wizard when setup is incomplete', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = urlOf(input);
        if (url.includes('/setup/status')) {
          return jsonResponse({
            ...SETUP_COMPLETE,
            administratorCreated: false,
            setupCompleted: false,
          });
        }
        if (url.includes('/auth/session'))
          return jsonResponse({ code: 'auth.session_required', title: 'x', status: 401 }, 401);
        return jsonResponse({}, 404);
      }),
    );

    render(<App />);

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: /set up xenitex/i })).toBeInTheDocument(),
    );
    expect(screen.getByLabelText(/^email$/i)).toBeInTheDocument();
  });

  // Regression: pointing the built app at the real (partially implemented)
  // API instead of the mock server surfaced this as a blank page — /setup/status
  // failing outright (rather than the mock's always-clean 200) had no
  // isError handling in AppRoot, so it silently fell through to "render the
  // setup wizard" instead of an error.
  it('shows an error state with retry when /setup/status itself fails, instead of a blank page or the wrong screen', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = urlOf(input);
        if (url.includes('/setup/status')) {
          return jsonResponse({ code: 'internal.unexpected', title: 'boom', status: 500 }, 500);
        }
        // A clean 401 here isolates this test to AppRoot's own isError
        // branch for /setup/status — SessionContext's throwOnError does not
        // rethrow for a clean 401, so it never competes with the assertion below.
        if (url.includes('/auth/session'))
          return jsonResponse({ code: 'auth.session_required', title: 'x', status: 401 }, 401);
        return jsonResponse({}, 404);
      }),
    );

    render(<App />);

    // A 500 (unlike a 401/404) is retried by the shared queryClient's retry
    // policy before settling into isError — real backoff delay, so a longer timeout.
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument(), { timeout: 8000 });
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
    expect(screen.queryByText(/set up xenitex/i)).not.toBeInTheDocument();
  });

  // Regression: a non-401 failure from /auth/session (e.g. the real API's
  // "route not found" for an endpoint Step 4 hasn't implemented yet, or any
  // 500) is intentionally rethrown during render by SessionContext's
  // `throwOnError` — without an error boundary anywhere, that unmounted the
  // entire app to a blank page instead of showing anything.
  it('shows an error state instead of a blank page when the session check fails with something other than a clean 401', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = urlOf(input);
        if (url.includes('/setup/status')) return jsonResponse(SETUP_COMPLETE);
        if (url.includes('/auth/session')) {
          return jsonResponse({ code: 'internal.unexpected', title: 'boom', status: 500 }, 500);
        }
        return jsonResponse({}, 404);
      }),
    );

    render(<App />);

    // A 500 (unlike a 401/404) is retried by the shared queryClient's retry
    // policy before settling into isError — real backoff delay, so a longer timeout.
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument(), { timeout: 8000 });
    expect(document.body.textContent).not.toBe('');
    consoleErrorSpy.mockRestore();
  });
});
