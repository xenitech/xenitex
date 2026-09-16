/**
 * Wraps an RFC 9457 Problem Details body (ADR 0006) as a thrown error so
 * react-query's `error` field carries it intact — screens branch on
 * `.code`, never on `.title`/`.detail` text, and render `.correlationId`
 * via ErrorState so an operator can quote it back in a support conversation.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly detail: string | undefined;
  readonly correlationId: string;

  constructor(
    problem: { status: number; code: string; title: string; detail?: string | undefined },
    correlationId: string,
  ) {
    super(problem.title);
    this.status = problem.status;
    this.code = problem.code;
    this.detail = problem.detail;
    this.correlationId = correlationId;
  }
}

interface FetchResult<T> {
  readonly data?: T;
  readonly error?: { status?: number; code?: string; title?: string; detail?: string | undefined };
  readonly response: Response;
}

/**
 * Unwraps an openapi-fetch result: returns `data` on success, throws
 * `ApiError` on any non-2xx. Every query/mutation function in `api/queries`
 * routes its result through this so error handling is uniform everywhere.
 *
 * `response.ok` (2xx) is checked before `data === undefined`, not the other
 * way around: a `204 No Content` -- logout, every /setup/* step, deactivate,
 * and every other no-body success response in this API -- legitimately
 * parses to `data: undefined` with no `error` either. The original
 * data-first check treated that as an "Empty response" failure on every
 * single 204 in the app, logout included, even though the request had
 * actually succeeded server-side (session revoked, cookie cleared) --
 * the caller just never found out.
 */
export function unwrap<T>(result: FetchResult<T>): T {
  const correlationId = result.response.headers.get('x-correlation-id') ?? 'unavailable';
  if (result.error) {
    const err = result.error;
    throw new ApiError(
      {
        status: err.status ?? result.response.status,
        code: err.code ?? 'unknown',
        title: err.title ?? 'Request failed',
        detail: err.detail,
      },
      correlationId,
    );
  }
  if (result.data === undefined && !result.response.ok) {
    throw new ApiError(
      { status: result.response.status, code: 'unknown', title: 'Empty response' },
      correlationId,
    );
  }
  return result.data as T;
}

/**
 * ADR 0006: mutable resources round-trip an `ETag`/`If-Match` pair. Screens
 * that mutate an issue, saved view, or scope keep `{ data, etag }` together
 * in query-cache state rather than re-deriving the ETag from somewhere else,
 * since it is opaque server state, not something the client can compute.
 */
export function unwrapWithETag<T>(result: FetchResult<T>): { data: T; etag: string | null } {
  return { data: unwrap(result), etag: result.response.headers.get('etag') };
}
