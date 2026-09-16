/**
 * Step 2.4: simulated partial failure for error-state UI testing (P1-11's
 * detail panel, dashboard tiles, etc. all need a real degraded-backend state
 * to render against). Two modes:
 *  - `X-Mock-Force-Status: 500` — deterministic, for a specific test case.
 *  - `X-Mock-Fail-Rate: 0.1` — probabilistic, for exploratory manual testing
 *    of "the backend is flaky" behaviour across a session.
 */
export function forcedStatus(header: string | string[] | undefined): number | null {
  const value = Array.isArray(header) ? header[0] : header;
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 400 && parsed < 600 ? parsed : null;
}

export function shouldInjectRandomFailure(header: string | string[] | undefined): boolean {
  const value = Array.isArray(header) ? header[0] : header;
  if (!value) return false;
  const rate = Number.parseFloat(value);
  if (!Number.isFinite(rate) || rate <= 0) return false;
  return Math.random() < Math.min(rate, 1);
}
