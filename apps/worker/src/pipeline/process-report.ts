import type { Kysely } from 'kysely';
import type { DB } from '@xenitex/db';
import { sql } from '@xenitex/db';
import type { WorkerDependencies } from '../dependencies.js';

/**
 * 4.8/P2-19. Three templates only — executive summary, technical detail,
 * and delta between two dates — rendered as HTML with a print stylesheet,
 * plus CSV and JSON. No headless browser dependency in this release
 * (P2-19), which is why the HTML carries its own `@media print` rules
 * rather than being rasterised server-side.
 *
 * Every report embeds generation time, scope, data versions, and the
 * scoring function version, so a reader can reproduce it and so two
 * readers comparing two copies can tell whether they are looking at the
 * same inputs.
 */

const MAX_ROWS_PER_REPORT = 50_000; // PERF-01's open-issue ceiling.

/**
 * SEC-17. Every string below that came from a scanned target — service,
 * product, version, hostname — is attacker-controlled. A report is HTML a
 * human opens in a browser, so this is the single most important function
 * in this file: it is what stops a crafted service banner on a customer's
 * network from becoming script execution in the reader's browser.
 *
 * Escaping `'` and `"` as well as the three structural characters means the
 * same function is safe in an attribute context, not just in text.
 */
function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/**
 * RFC 4180 quoting. A leading `=`, `+`, `-` or `@` is additionally prefixed
 * with a single quote: spreadsheet applications interpret such a cell as a
 * formula, so a service banner of `=cmd|'/c calc'!A1` in a CSV export
 * becomes code execution when the recipient opens it. That is a real,
 * well-known export vector and it applies squarely to scanner-derived
 * strings (SEC-17).
 */
function escapeCsv(value: unknown): string {
  let text = String(value ?? '');
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

interface ReportRow {
  id: string;
  template: string;
  scope_filter: unknown;
  date_range_start: Date | string | null;
  date_range_end: Date | string | null;
  formats: string[];
  generated_by: string;
  generated_at: Date | string;
}

interface IssueReportRow {
  id: string;
  severity: string;
  risk_score: string | number;
  confidence: string | number;
  confidence_label: string | null;
  state: string;
  port: number | null;
  protocol: string | null;
  service_untrusted: string | null;
  product_untrusted: string | null;
  version_untrusted: string | null;
  first_seen: Date | string;
  last_seen: Date | string;
  due_date: Date | string | null;
  risk_score_policy_version: number;
  vuln_identifier: string | null;
  known_exploited: boolean | null;
  asset_address: string | null;
}

interface ReportPayload {
  readonly report: {
    readonly id: string;
    readonly template: string;
    readonly generatedAt: string;
    readonly scopeFilter: unknown;
    readonly dateRangeStart: string | null;
    readonly dateRangeEnd: string | null;
  };
  readonly dataVersions: {
    readonly vulnerabilityDataImportId: string | null;
    readonly vulnerabilityDataImportedAt: string | null;
    readonly riskScoringPolicyVersion: number | null;
  };
  readonly summary: Record<string, number>;
  readonly issues: readonly IssueReportRow[];
}

async function collectDataVersions(db: Kysely<DB>): Promise<ReportPayload['dataVersions']> {
  const [intel, policy] = await Promise.all([
    db
      .selectFrom('vulnerability_data_imports')
      .select(['id', 'imported_at'])
      .where('status', '=', 'applied')
      .orderBy('imported_at', 'desc')
      .limit(1)
      .executeTakeFirst(),
    db
      .selectFrom('risk_scoring_policies')
      .select('version')
      .where('is_active', '=', true)
      .executeTakeFirst(),
  ]);
  return {
    vulnerabilityDataImportId: intel?.id ?? null,
    vulnerabilityDataImportedAt: intel ? new Date(intel.imported_at).toISOString() : null,
    riskScoringPolicyVersion: policy?.version ?? null,
  };
}

/**
 * MOD-10: the states that represent unresolved work. A report that counted
 * risk-accepted or false-positive issues alongside open ones would
 * overstate the customer's exposure and undermine the register they
 * deliberately maintain (MOD-12).
 */
const OPEN_STATES = ['new', 'triaged', 'in_progress', 'reopened'] as const;

async function loadIssues(db: Kysely<DB>, report: ReportRow): Promise<IssueReportRow[]> {
  let query = db
    .selectFrom('issues')
    .leftJoin('vulnerabilities', 'vulnerabilities.id', 'issues.vulnerability_id')
    .leftJoin('asset_address_history', (join) =>
      join
        .onRef('asset_address_history.asset_id', '=', 'issues.asset_id')
        .on('asset_address_history.is_current', '=', true),
    )
    .select([
      'issues.id',
      'issues.severity',
      'issues.risk_score',
      'issues.confidence',
      'issues.confidence_label',
      'issues.state',
      'issues.port',
      'issues.protocol',
      'issues.service_untrusted',
      'issues.product_untrusted',
      'issues.version_untrusted',
      'issues.first_seen',
      'issues.last_seen',
      'issues.due_date',
      'issues.risk_score_policy_version',
      'vulnerabilities.vuln_identifier',
      'vulnerabilities.known_exploited',
      sql<string | null>`host(asset_address_history.address)`.as('asset_address'),
    ])
    .orderBy('issues.risk_score', 'desc')
    .limit(MAX_ROWS_PER_REPORT);

  if (report.template === 'delta') {
    // The delta is "what changed between these dates" — issues first seen
    // inside the window. Bounded by first_seen rather than last_seen so
    // re-observing an old issue does not make it look new.
    if (report.date_range_start)
      query = query.where('issues.first_seen', '>=', new Date(report.date_range_start) as never);
    if (report.date_range_end)
      query = query.where('issues.first_seen', '<=', new Date(report.date_range_end) as never);
  } else {
    query = query.where('issues.state', 'in', OPEN_STATES as never);
  }

  return (await query.execute()) as IssueReportRow[];
}

function summarise(issues: readonly IssueReportRow[]): Record<string, number> {
  const summary: Record<string, number> = {
    total: issues.length,
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    info: 0,
    knownExploited: 0,
    lowConfidence: 0,
    overdue: 0,
  };
  const today = new Date();
  for (const issue of issues) {
    if (issue.severity in summary) summary[issue.severity] = (summary[issue.severity] ?? 0) + 1;
    if (issue.known_exploited) summary.knownExploited = (summary.knownExploited ?? 0) + 1;
    // MOD-20: the count of low-confidence findings is reported alongside
    // the totals, never folded into them — QA-00 is explicit that
    // inference must not be presented with the weight of proof.
    if (issue.confidence_label === 'low') summary.lowConfidence = (summary.lowConfidence ?? 0) + 1;
    if (issue.due_date && new Date(issue.due_date) < today)
      summary.overdue = (summary.overdue ?? 0) + 1;
  }
  return summary;
}

const PRINT_STYLESHEET = `
  :root { color-scheme: light; }
  body { font-family: system-ui, -apple-system, 'Segoe UI', sans-serif; margin: 2rem; color: #111; line-height: 1.5; }
  h1 { font-size: 1.6rem; margin-bottom: 0.25rem; }
  h2 { font-size: 1.15rem; margin-top: 2rem; border-bottom: 1px solid #ddd; padding-bottom: 0.25rem; }
  .provenance { font-size: 0.8rem; color: #555; background: #f6f6f6; padding: 0.75rem 1rem; border-left: 3px solid #999; }
  .provenance dt { font-weight: 600; float: left; clear: left; width: 16rem; }
  .provenance dd { margin: 0 0 0.2rem 16rem; }
  table { border-collapse: collapse; width: 100%; font-size: 0.85rem; margin-top: 0.5rem; }
  th, td { border: 1px solid #ddd; padding: 0.35rem 0.5rem; text-align: start; vertical-align: top; }
  th { background: #f2f2f2; }
  .sev-critical { background: #fdecea; } .sev-high { background: #fff4e5; }
  .conf-low { color: #666; font-style: italic; }
  .tiles { display: flex; flex-wrap: wrap; gap: 0.75rem; margin-top: 0.75rem; }
  .tile { border: 1px solid #ddd; padding: 0.6rem 1rem; min-width: 8rem; }
  .tile .n { font-size: 1.5rem; font-weight: 600; display: block; }
  .tile .l { font-size: 0.75rem; color: #555; text-transform: uppercase; letter-spacing: 0.04em; }
  .caveat { font-size: 0.8rem; color: #555; margin-top: 0.5rem; }
  @media print {
    body { margin: 0.6in; font-size: 10pt; }
    h2 { break-after: avoid; }
    tr { break-inside: avoid; }
    thead { display: table-header-group; }
    .no-print { display: none; }
  }
`;

const TEMPLATE_TITLES: Record<string, string> = {
  executive_summary: 'Executive Summary',
  technical_detail: 'Technical Detail',
  delta: 'Change Report',
};

function renderHtml(payload: ReportPayload): string {
  const { report, dataVersions, summary, issues } = payload;
  const title = TEMPLATE_TITLES[report.template] ?? report.template;

  const tile = (label: string, n: number) =>
    `<div class="tile"><span class="n">${escapeHtml(n)}</span><span class="l">${escapeHtml(label)}</span></div>`;

  // The executive summary is deliberately the top slice by risk, not every
  // row: MOD-16 is explicit that a list of twelve thousand equally critical
  // items has failed its only job.
  const rows = report.template === 'executive_summary' ? issues.slice(0, 25) : issues;

  const tableRows = rows
    .map((issue) => {
      const severityClass = `sev-${issue.severity}`;
      const confidenceClass = issue.confidence_label === 'low' ? 'conf-low' : '';
      return `<tr class="${severityClass}">
        <td>${escapeHtml(Math.round(Number(issue.risk_score)))}</td>
        <td>${escapeHtml(issue.severity)}</td>
        <td>${escapeHtml(issue.vuln_identifier ?? '—')}${issue.known_exploited ? ' <strong>(known-exploited)</strong>' : ''}</td>
        <td>${escapeHtml(issue.asset_address ?? '—')}</td>
        <td>${escapeHtml(issue.port ?? '—')}/${escapeHtml(issue.protocol ?? '—')}</td>
        <td>${escapeHtml(issue.product_untrusted ?? issue.service_untrusted ?? '—')} ${escapeHtml(issue.version_untrusted ?? '')}</td>
        <td class="${confidenceClass}">${escapeHtml(issue.confidence_label ?? '—')}</td>
        <td>${escapeHtml(issue.state)}</td>
        <td>${escapeHtml(issue.due_date ? new Date(issue.due_date).toISOString().slice(0, 10) : '—')}</td>
      </tr>`;
    })
    .join('\n');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)} — Xenitex</title>
<style>${PRINT_STYLESHEET}</style>
</head>
<body>
<h1>${escapeHtml(title)}</h1>

<h2>Provenance</h2>
<dl class="provenance">
  <dt>Report identifier</dt><dd>${escapeHtml(report.id)}</dd>
  <dt>Generated at (UTC)</dt><dd>${escapeHtml(report.generatedAt)}</dd>
  <dt>Scope filter</dt><dd>${escapeHtml(JSON.stringify(report.scopeFilter))}</dd>
  <dt>Date range</dt><dd>${escapeHtml(report.dateRangeStart ?? 'all time')} to ${escapeHtml(report.dateRangeEnd ?? 'now')}</dd>
  <dt>Vulnerability data import</dt><dd>${escapeHtml(dataVersions.vulnerabilityDataImportId ?? 'none applied')} (${escapeHtml(dataVersions.vulnerabilityDataImportedAt ?? 'n/a')})</dd>
  <dt>Risk scoring function version</dt><dd>${escapeHtml(dataVersions.riskScoringPolicyVersion ?? 'n/a')}</dd>
</dl>

<h2>Summary</h2>
<div class="tiles">
  ${tile('Total', summary.total ?? 0)}
  ${tile('Critical', summary.critical ?? 0)}
  ${tile('High', summary.high ?? 0)}
  ${tile('Known-exploited', summary.knownExploited ?? 0)}
  ${tile('Overdue', summary.overdue ?? 0)}
  ${tile('Low confidence', summary.lowConfidence ?? 0)}
</div>
<p class="caveat">
  This appliance performs uncredentialed scanning. Findings labelled
  <em>low confidence</em> are inferred from version strings and have a
  meaningful false-positive rate; they are counted separately above and are
  not presented with the same weight as directly observed evidence. Every
  finding in this report links to inspectable evidence in the panel.
</p>

<h2>Findings${report.template === 'executive_summary' && issues.length > rows.length ? ` (top ${rows.length} of ${issues.length} by risk)` : ''}</h2>
<table>
  <thead><tr>
    <th>Risk</th><th>Severity</th><th>Vulnerability</th><th>Asset</th>
    <th>Port</th><th>Service</th><th>Confidence</th><th>State</th><th>Due</th>
  </tr></thead>
  <tbody>
${tableRows || '<tr><td colspan="9">No findings matched this report’s filters.</td></tr>'}
  </tbody>
</table>
</body>
</html>`;
}

function renderCsv(payload: ReportPayload): string {
  const header = [
    'issue_id',
    'risk_score',
    'severity',
    'vulnerability',
    'known_exploited',
    'asset_address',
    'port',
    'protocol',
    'service',
    'product',
    'version',
    'confidence',
    'confidence_label',
    'state',
    'first_seen',
    'last_seen',
    'due_date',
    'risk_scoring_policy_version',
  ].join(',');

  const lines = payload.issues.map((issue) =>
    [
      issue.id,
      Number(issue.risk_score),
      issue.severity,
      issue.vuln_identifier ?? '',
      issue.known_exploited ?? false,
      issue.asset_address ?? '',
      issue.port ?? '',
      issue.protocol ?? '',
      issue.service_untrusted ?? '',
      issue.product_untrusted ?? '',
      issue.version_untrusted ?? '',
      Number(issue.confidence),
      issue.confidence_label ?? '',
      issue.state,
      new Date(issue.first_seen).toISOString(),
      new Date(issue.last_seen).toISOString(),
      issue.due_date ? new Date(issue.due_date).toISOString().slice(0, 10) : '',
      issue.risk_score_policy_version,
    ]
      .map(escapeCsv)
      .join(','),
  );

  // Provenance rides along as comment lines so a CSV is as reproducible as
  // the HTML — the same requirement, in the format a spreadsheet gets.
  const provenance = [
    `# report_id=${payload.report.id}`,
    `# generated_at=${payload.report.generatedAt}`,
    `# template=${payload.report.template}`,
    `# vulnerability_data_import=${payload.dataVersions.vulnerabilityDataImportId ?? 'none'}`,
    `# risk_scoring_policy_version=${payload.dataVersions.riskScoringPolicyVersion ?? 'n/a'}`,
  ];

  return [...provenance, header, ...lines].join('\n') + '\n';
}

export async function processReport(reportId: string, deps: WorkerDependencies): Promise<void> {
  const { db, blobStore } = deps;
  const report = (await db
    .selectFrom('reports')
    .selectAll()
    .where('id', '=', reportId)
    .executeTakeFirst()) as ReportRow | undefined;
  if (!report) return;

  const [issues, dataVersions] = await Promise.all([
    loadIssues(db, report),
    collectDataVersions(db),
  ]);

  const payload: ReportPayload = {
    report: {
      id: report.id,
      template: report.template,
      generatedAt: new Date(report.generated_at).toISOString(),
      scopeFilter: report.scope_filter,
      dateRangeStart: report.date_range_start
        ? new Date(report.date_range_start).toISOString().slice(0, 10)
        : null,
      dateRangeEnd: report.date_range_end
        ? new Date(report.date_range_end).toISOString().slice(0, 10)
        : null,
    },
    dataVersions,
    summary: summarise(issues),
    issues,
  };

  const blobStoreKey = `reports/${report.id}`;
  for (const format of report.formats) {
    const body =
      format === 'html'
        ? renderHtml(payload)
        : format === 'csv'
          ? renderCsv(payload)
          : JSON.stringify(payload, null, 2);
    await blobStore.put(
      `${blobStoreKey}.${format}`,
      Buffer.from(body, 'utf8'),
      format === 'json' ? 'application/json' : `text/${format}`,
    );
  }

  await db
    .updateTable('reports')
    .set({
      status: 'completed',
      blob_store_key: blobStoreKey,
      completed_at: new Date(),
      data_versions: JSON.stringify(dataVersions) as never,
    })
    .where('id', '=', reportId)
    .where('status', '=', 'pending')
    .execute();
}
