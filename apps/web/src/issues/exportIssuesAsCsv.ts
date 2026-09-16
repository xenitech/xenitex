import type { Issue } from '../api/types.js';

function csvCell(value: string): string {
  // RFC 4180: quote and escape any cell that could otherwise break the row —
  // including scanner-derived asset labels (SEC-17), which are untrusted input.
  return /[",\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

/** "Export view" (docs/design/review.md): issues are system-detected, not user-created, so the header action exports the current view rather than creating something. */
export function exportIssuesAsCsv(issues: readonly Issue[]): void {
  const header = [
    'id',
    'title',
    'primaryCveId',
    'assetLabel',
    'severity',
    'riskScore',
    'confidenceLabel',
    'state',
    'firstSeen',
    'lastSeen',
    'dueDate',
  ];
  const rows = issues.map((issue) =>
    [
      issue.id,
      issue.title ?? '',
      issue.primaryCveId ?? '',
      issue.assetLabelUntrusted ?? '',
      issue.severity,
      String(issue.riskScore),
      issue.confidenceLabel,
      issue.state,
      issue.firstSeen,
      issue.lastSeen,
      issue.dueDate ?? '',
    ].map(csvCell),
  );
  const csv = [header.join(','), ...rows.map((r) => r.join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `issues-export-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}
