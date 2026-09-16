/**
 * Step 2.4 requires the mock server to simulate realistic latency so Step
 * 3's loading-state UI is actually exercised against something other than
 * an instant localhost response. `X-Mock-Latency: 0` disables it entirely —
 * used by contract tests so they run fast and deterministically.
 */
export function simulatedLatencyMs(header: string | string[] | undefined): number {
  if (header === '0') return 0;
  const min = 20;
  const max = 180;
  return min + Math.random() * (max - min);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
