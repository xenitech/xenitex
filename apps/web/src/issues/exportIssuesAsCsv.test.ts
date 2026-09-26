import { describe, expect, it, vi } from 'vitest';
import { exportIssuesAsCsv } from './exportIssuesAsCsv.js';
import type { Issue } from '../api/types.js';

/**
 * SEC-17 + spreadsheet-formula-injection. `assetLabelUntrusted` and `title`
 * are scanner-derived strings — a crafted hostname or banner is exactly the
 * kind of value that reaches this exporter, and a cell starting with
 * `=`/`+`/`-`/`@` is executed as a formula by Excel/LibreOffice the moment
 * an analyst opens the exported file. This used to be guarded only against
 * breaking the CSV's own row/column structure (commas/quotes/newlines),
 * not against the exported file DOING something when opened — the same
 * defect class the report generator (process-report.ts) already defends
 * against, and this file did not.
 */

function baseIssue(overrides: Partial<Issue> = {}): Issue {
  return {
    id: 'issue-1',
    fingerprint: 'fp',
    fingerprintVersion: 1,
    assetId: 'asset-1',
    vulnerabilityId: null,
    port: 80,
    protocol: 'tcp',
    serviceUntrusted: null,
    productUntrusted: null,
    versionUntrusted: null,
    severity: 'medium',
    riskScore: 40,
    riskScorePolicyVersion: 1,
    confidence: 0.75,
    confidenceLabel: 'high',
    matchExplanation: null,
    matchReasons: [],
    state: 'new',
    contributingObservationIds: [],
    ownerUserId: null,
    dueDate: null,
    exceptionRef: null,
    firstSeen: '2026-01-01T00:00:00Z',
    lastSeen: '2026-01-01T00:00:00Z',
    lastVerifiedAt: null,
    title: undefined,
    primaryCveId: null,
    assetLabelUntrusted: '',
    ...overrides,
  } as Issue;
}

/**
 * Captures the CSV text passed to `new Blob([csv], ...)` without touching
 * real DOM download machinery. Reads the Blob constructor argument directly
 * rather than calling `.text()` on the resulting Blob — jsdom's Blob
 * polyfill does not implement that method.
 */
function captureCsv(issues: readonly Issue[]): string {
  const originalCreateObjectURL = URL.createObjectURL;
  const originalRevokeObjectURL = URL.revokeObjectURL;
  let capturedCsv: string | undefined;

  const OriginalBlob = globalThis.Blob;
  class CapturingBlob extends OriginalBlob {
    constructor(parts: BlobPart[], options?: BlobPropertyBag) {
      super(parts, options);
      capturedCsv = parts.join('');
    }
  }
  globalThis.Blob = CapturingBlob as typeof Blob;
  URL.createObjectURL = vi.fn(() => 'blob:mock');
  URL.revokeObjectURL = vi.fn();

  const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

  try {
    exportIssuesAsCsv(issues);
  } finally {
    globalThis.Blob = OriginalBlob;
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
    clickSpy.mockRestore();
  }

  return capturedCsv!;
}

describe('exportIssuesAsCsv (SEC-17 / formula injection)', () => {
  it('prefixes a leading = with an apostrophe so Excel/LibreOffice treats it as text', () => {
    const csv = captureCsv([baseIssue({ assetLabelUntrusted: '=cmd|calc!A1' })]);
    const dataLine = csv.split('\n')[1]!;
    // No surrounding quotes needed here (no comma/quote/newline in the raw
    // value), so the leading-apostrophe defense is visible unescaped.
    expect(dataLine).toContain("'=cmd|calc!A1");
    // The critical property: nothing in the exported row is a bare `=...`
    // that a spreadsheet would treat as an active formula.
    expect(dataLine).not.toMatch(/(^|,)=/);
  });

  it('neutralises +, -, and @ leading characters the same way', () => {
    for (const dangerous of ['+1+1', '-2+3', '@SUM(A1:A9)']) {
      const csv = captureCsv([baseIssue({ assetLabelUntrusted: dangerous })]);
      const dataLine = csv.split('\n')[1]!;
      expect(dataLine).toContain(`'${dangerous}`);
    }
  });

  it('still quotes a formula-looking value that also contains a comma', () => {
    const csv = captureCsv([baseIssue({ assetLabelUntrusted: '=SUM(1,2)' })]);
    const dataLine = csv.split('\n')[1]!;
    expect(dataLine).toContain(`"'=SUM(1,2)"`);
  });

  it('leaves an ordinary value untouched', () => {
    const csv = captureCsv([baseIssue({ assetLabelUntrusted: 'web-server-01' })]);
    const dataLine = csv.split('\n')[1]!;
    expect(dataLine).toContain('web-server-01');
    expect(dataLine).not.toContain("'web-server-01");
  });

  it('still escapes embedded quotes and commas per RFC 4180', () => {
    const csv = captureCsv([baseIssue({ assetLabelUntrusted: 'host, "weird" name' })]);
    const dataLine = csv.split('\n')[1]!;
    expect(dataLine).toContain('"host, ""weird"" name"');
  });

  it('never throws on hostile or pathological banner-derived input', () => {
    const hostile = [
      '<script>alert(1)</script>',
      "'; DROP TABLE issues; --",
      '\t=1+1',
      '\r-1-1',
      'A'.repeat(5000),
    ];
    for (const value of hostile) {
      expect(() => captureCsv([baseIssue({ assetLabelUntrusted: value })])).not.toThrow();
    }
  });
});
