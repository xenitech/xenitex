import type { Issue } from '../api/types.js';

function csvCell(value: string): string {
  // RFC 4180 quoting, PLUS spreadsheet-formula-injection protection —
  // matching apps/worker/src/pipeline/process-report.ts's escapeCsv, which
  // this duplicates rather than imports (that file is worker-only code; this
  // one runs in the browser). A cell starting with =, +, -, or @ is executed
  // as a formula by Excel/LibreOffice when the analyst opens the exported
  // file, and `assetLabelUntrusted`/`title` here are SEC-17 scanner-derived
  // strings — a crafted hostname or banner is exactly the kind of value that
  // reaches this function. The previous version only guarded against
  // breaking the CSV's own row/column structure, not against the exported
  // file executing something when opened.
  let text = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  if (/[",\n]/.test(text)) text = `"${text.replaceAll('"', '""')}"`;
  return text;
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
