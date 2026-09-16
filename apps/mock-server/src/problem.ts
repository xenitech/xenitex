/**
 * ADR 0006: every non-2xx response is application/problem+json (RFC 9457)
 * with a stable, namespaced `code` clients branch on — never title/detail text.
 */
export interface ProblemDetails {
  readonly type: string;
  readonly title: string;
  readonly status: number;
  readonly detail?: string;
  readonly instance?: string;
  readonly code: string;
}

export function problem(
  status: number,
  code: string,
  title: string,
  detail?: string,
): ProblemDetails {
  return {
    type: `https://xenitex.internal/problems/${code.replaceAll('.', '/')}`,
    title,
    status,
    code,
    ...(detail ? { detail } : {}),
  };
}

export const Problems = {
  notFound: (resource: string) => problem(404, `${resource}.not_found`, 'Resource not found'),
  staleResource: () =>
    problem(
      409,
      'concurrency.stale_resource',
      'Resource was modified since it was last fetched',
      'The supplied If-Match no longer matches the current ETag.',
    ),
  ifMatchRequired: () =>
    problem(428, 'concurrency.if_match_required', 'If-Match header is required for this mutation'),
  validationFailed: (detail: string) =>
    problem(400, 'validation.schema_violation', 'Request failed schema validation', detail),
  forbidden: (requiredRole: string) =>
    problem(
      403,
      'auth.insufficient_role',
      'Not authorized for this action',
      `Requires role: ${requiredRole}.`,
    ),
  unauthorized: () => problem(401, 'auth.session_required', 'Authentication required'),
  conflict: (code: string, detail?: string) =>
    problem(409, code, 'Request conflicts with current state', detail),
  unprocessable: (code: string, detail: string) =>
    problem(422, code, 'Request cannot be processed as specified', detail),
  simulatedFailure: (status = 500) =>
    problem(
      status,
      'mock.simulated_failure',
      'Simulated backend failure',
      'Injected by the mock server (X-Mock-Fail-Rate / X-Mock-Force-Status) for Step 3 error-state testing.',
    ),
} as const;
