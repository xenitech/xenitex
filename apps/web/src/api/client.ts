import { createXenitexClient } from '@xenitex/contracts';

/**
 * Same-origin `/v1` in every environment (dev proxy in vite.config.ts,
 * reverse proxy in deploy/compose) — SEC-08's session cookie is
 * `SameSite=Strict`, which requires same-origin requests to round-trip it.
 * Resolved against `window.location.origin` rather than left as a bare
 * `/v1` string: Node's undici-based `fetch` (used under Vitest/jsdom, unlike
 * a real browser's `fetch`) refuses to construct a `Request` from a
 * relative URL, even though jsdom's own `window.location` has an origin.
 */
export const apiClient = createXenitexClient({
  baseUrl: new URL('/v1', window.location.origin).toString(),
  credentials: 'include',
  // openapi-fetch resolves its `fetch` default (`globalThis.fetch`) once, at
  // client-construction time — this module is a singleton created at import
  // time, so without this wrapper a test's `vi.stubGlobal('fetch', ...)`
  // (which runs later, inside the test body) would never take effect. A
  // plain forwarding function instead reads `globalThis.fetch` fresh on
  // every call.
  fetch: (...args: Parameters<typeof fetch>) => globalThis.fetch(...args),
});

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function readCookie(name: string): string | undefined {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match?.[1] !== undefined ? decodeURIComponent(match[1]) : undefined;
}

// SEC-08 double-submit: the server issues `xenitex_csrf` deliberately
// readable (not HttpOnly) so the client can echo it back as a header on
// every mutating request; the server compares its hash against the
// session's stored csrf_token_hash, never a bare cookie-equals-cookie
// check. Without this, every POST/PUT/PATCH/DELETE 403s once a session
// exists (auth.ts's requireSession rejects mutations with no/invalid
// X-CSRF-Token) — there was no middleware attaching it at all.
apiClient.use({
  onRequest({ request }) {
    if (MUTATING_METHODS.has(request.method)) {
      const csrfToken = readCookie('xenitex_csrf');
      if (csrfToken) {
        request.headers.set('X-CSRF-Token', csrfToken);
      }
    }
    return request;
  },
});
