import { gunzipSync } from 'node:zlib';
import type { Kysely } from 'kysely';
import type { DB } from '@xenitex/db';
import { appendAuditEntry } from '@xenitex/db';
import { newId } from '@xenitex/domain';

/**
 * docs/cve-intel-feature-spec.md FEED-08.1/FEED-18. Egress is scoped to
 * exactly these two hostnames, hardcoded — there is no code path anywhere
 * in this file that constructs a URL from anything other than these
 * constants and query parameters this module builds itself (FEED-19: not
 * user-editable, ANTI-14).
 *
 * FEED-08.2 (CISA KEV direct fetch) is NOT implemented here: it returned
 * 403 from cisa.gov's edge WAF in this development environment (an
 * Akamai/edge bot-protection block, not a code issue) and could not be
 * built against real traffic. `cisaExploitAdd` below is NVD's own
 * annotation of KEV membership on each CVE record, used as an honest
 * substitute for now — a dedicated KEV adapter is deferred until it can be
 * verified against real responses from a real deployment network.
 */
const NVD_API_HOST = 'services.nvd.nist.gov';
const NVD_API_URL = 'https://services.nvd.nist.gov/rest/json/cves/2.0';
const EPSS_HOST = 'epss.cyentia.com';
const EPSS_BULK_URL = 'https://epss.cyentia.com/epss_scores-current.csv.gz';

const NVD_PAGE_SIZE = 200;
/** Unauthenticated NVD rate limit is 5 requests per rolling 30s window — this stays comfortably under it. */
const NVD_REQUEST_DELAY_MS = 6500;
/**
 * FEED-15 suggests "under 10 seconds" for detecting no connectivity at all,
 * distinct from a slow-but-working request. Measured directly against the
 * real API repeatedly from inside the worker container: a genuinely
 * working connection's single-page response time varied from ~2s to over
 * 15s run to run (this development network's egress bandwidth to these
 * specific hosts is inconsistent, not a fixed latency) — 9s and then 15s
 * both produced false "no connectivity" positives on a link that was
 * actually fine. 25s is set with real margin above the worst case actually
 * observed, not guessed; a real deployment on ordinary bandwidth will
 * clear this in a fraction of that.
 */
const CONNECTIVITY_CHECK_TIMEOUT_MS = 25_000;
/**
 * Measured directly against the real EPSS bulk file (2.6 MB gzipped) from
 * inside this worker container: ~20s end to end on one run. 90s gives real
 * headroom above an observed real number on an inconsistent link, rather
 * than a guessed one — this whole sync is a background job an operator
 * triggers and walks away from (UI-107), not a request anyone is blocked
 * waiting on synchronously.
 */
const NORMAL_REQUEST_TIMEOUT_MS = 90_000;
/** Safety cap so a wide `modifiedSinceDays` can't turn one sync into an unbounded fetch loop. */
const MAX_PAGES_PER_SYNC = 100;

const DEFAULT_SEVERITY_FLOOR = 4.0; // FEED-04 suggested default
const DEFAULT_EXPLOIT_PROBABILITY_THRESHOLD = 0.1; // FEED-03 suggested default

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface NvdCvssPick {
  readonly version: string;
  readonly vector: string;
  readonly baseScore: number;
}

interface ParsedNvdRecord {
  readonly cveId: string;
  readonly description: string | null;
  readonly cwe: string | null;
  readonly cvss: NvdCvssPick | null;
  readonly cpes: readonly { cpe: string; versionRange: string | null }[];
  readonly knownExploited: boolean;
  readonly publishedAt: string | null;
  readonly modifiedAt: string | null;
}

/** MATCH-17: prefer v4.0, then v3.1, then v3.0, then v2 — recorded on the issue which version fed the score. */
function pickBestCvss(metrics: Record<string, unknown> | undefined): NvdCvssPick | null {
  if (!metrics) return null;
  const order = ['cvssMetricV40', 'cvssMetricV31', 'cvssMetricV30', 'cvssMetricV2'] as const;
  for (const key of order) {
    const entries = metrics[key] as
      | readonly {
          type?: string;
          cvssData: { version: string; vectorString: string; baseScore: number };
        }[]
      | undefined;
    if (!entries || entries.length === 0) continue;
    const primary = entries.find((e) => e.type === 'Primary') ?? entries[0]!;
    return {
      version: primary.cvssData.version,
      vector: primary.cvssData.vectorString,
      baseScore: primary.cvssData.baseScore,
    };
  }
  return null;
}

function parseNvdCve(raw: Record<string, unknown>): ParsedNvdRecord {
  const descriptions = raw.descriptions as readonly { lang: string; value: string }[] | undefined;
  const weaknesses = raw.weaknesses as
    readonly { description: readonly { lang: string; value: string }[] }[] | undefined;
  const configurations = raw.configurations as
    readonly { nodes: readonly { cpeMatch: readonly Record<string, unknown>[] }[] }[] | undefined;

  const cpes: { cpe: string; versionRange: string | null }[] = [];
  for (const config of configurations ?? []) {
    for (const node of config.nodes) {
      for (const match of node.cpeMatch) {
        const criteria = match.criteria as string | undefined;
        if (!criteria) continue;
        const bounds: string[] = [];
        if (typeof match.versionStartIncluding === 'string')
          bounds.push(`>=${match.versionStartIncluding}`);
        if (typeof match.versionStartExcluding === 'string')
          bounds.push(`>${match.versionStartExcluding}`);
        if (typeof match.versionEndIncluding === 'string')
          bounds.push(`<=${match.versionEndIncluding}`);
        if (typeof match.versionEndExcluding === 'string')
          bounds.push(`<${match.versionEndExcluding}`);
        cpes.push({ cpe: criteria, versionRange: bounds.length > 0 ? bounds.join(' ') : null });
      }
    }
  }

  return {
    cveId: raw.id as string,
    description: descriptions?.find((d) => d.lang === 'en')?.value ?? null,
    cwe: weaknesses?.[0]?.description.find((d) => d.lang === 'en')?.value ?? null,
    cvss: pickBestCvss(raw.metrics as Record<string, unknown> | undefined),
    cpes,
    // NVD's own CISA KEV annotation — see file header comment.
    knownExploited: typeof raw.cisaExploitAdd === 'string',
    publishedAt: (raw.published as string | undefined) ?? null,
    modifiedAt: (raw.lastModified as string | undefined) ?? null,
  };
}

function nvdTimestamp(date: Date): string {
  // NVD wants `YYYY-MM-DDTHH:mm:ss.sss` with no timezone suffix, per its documented format.
  return date.toISOString().replace('Z', '');
}

async function fetchNvdWindow(
  modifiedSinceDays: number,
  onFirstRequestConnectivityError: () => never,
): Promise<readonly ParsedNvdRecord[]> {
  const endDate = new Date();
  const startDate = new Date(endDate.getTime() - modifiedSinceDays * 24 * 60 * 60 * 1000);
  const records: ParsedNvdRecord[] = [];
  let startIndex = 0;
  let page = 0;
  let totalResults = Infinity;

  while (startIndex < totalResults && page < MAX_PAGES_PER_SYNC) {
    const url = new URL(NVD_API_URL);
    url.searchParams.set('lastModStartDate', nvdTimestamp(startDate));
    url.searchParams.set('lastModEndDate', nvdTimestamp(endDate));
    url.searchParams.set('startIndex', String(startIndex));
    url.searchParams.set('resultsPerPage', String(NVD_PAGE_SIZE));

    if (page > 0) await sleep(NVD_REQUEST_DELAY_MS);
    let response: Response;
    try {
      response = await fetch(url, {
        signal: AbortSignal.timeout(
          page === 0 ? CONNECTIVITY_CHECK_TIMEOUT_MS : NORMAL_REQUEST_TIMEOUT_MS,
        ),
      });
    } catch (error) {
      if (page === 0) onFirstRequestConnectivityError();
      throw error;
    }
    if (!response.ok) {
      throw new Error(`NVD API returned ${response.status} ${response.statusText}`);
    }
    const body = (await response.json()) as {
      totalResults: number;
      vulnerabilities: readonly { cve: Record<string, unknown> }[];
    };
    totalResults = body.totalResults;
    for (const item of body.vulnerabilities) records.push(parseNvdCve(item.cve));
    startIndex += NVD_PAGE_SIZE;
    page += 1;
  }
  return records;
}

async function fetchEpssScores(): Promise<ReadonlyMap<string, number>> {
  const response = await fetch(EPSS_BULK_URL, {
    signal: AbortSignal.timeout(NORMAL_REQUEST_TIMEOUT_MS),
  });
  if (!response.ok)
    throw new Error(`EPSS bulk fetch returned ${response.status} ${response.statusText}`);
  const compressed = Buffer.from(await response.arrayBuffer());
  const csv = gunzipSync(compressed).toString('utf8');
  const scores = new Map<string, number>();
  // First two lines are a `#model_version:...` comment and the header row.
  for (const line of csv.split('\n').slice(2)) {
    const [cve, epss] = line.split(',');
    if (!cve || !epss) continue;
    scores.set(cve, Number.parseFloat(epss));
  }
  return scores;
}

class ConnectivityError extends Error {
  constructor() {
    super('no_connectivity');
  }
}

export interface IntelImportOptions {
  readonly modifiedSinceDays: number;
  readonly severityFloor?: number;
  readonly exploitProbabilityThreshold?: number;
}

export async function processIntelImport(importId: string, db: Kysely<DB>): Promise<void> {
  const importRow = await db
    .selectFrom('vulnerability_data_imports')
    .select('record_counts')
    .where('id', '=', importId)
    .executeTakeFirst();
  // apps/api's POST /intel/sync stashes the requested options here at
  // creation time (before this worker ever sees the row) — record_counts is
  // overwritten with the real result at the end of a successful run, so
  // there's no column dedicated to "requested options" surviving past that.
  const requested = (importRow?.record_counts as { requestedOptions?: IntelImportOptions } | null)
    ?.requestedOptions ?? { modifiedSinceDays: 7 };
  const options = requested;

  const settings = await db
    .selectFrom('intel_settings')
    .selectAll()
    .where('id', '=', 1)
    .executeTakeFirst();
  if (settings?.online_updates_disabled) {
    // Second-layer check (SAFE-02-style): apps/api already refuses to create
    // the import row when disabled, but the flag could change between
    // creation and this worker picking it up.
    await db
      .updateTable('vulnerability_data_imports')
      .set({ status: 'failed', failure_reason: 'online_updates_disabled' })
      .where('id', '=', importId)
      .execute();
    return;
  }

  const severityFloor = options.severityFloor ?? DEFAULT_SEVERITY_FLOOR;
  const exploitProbabilityThreshold =
    options.exploitProbabilityThreshold ?? DEFAULT_EXPLOIT_PROBABILITY_THRESHOLD;
  const windowStartedAt = new Date();

  let nvdRecords: readonly ParsedNvdRecord[];
  let epssScores: ReadonlyMap<string, number>;
  try {
    nvdRecords = await fetchNvdWindow(options.modifiedSinceDays, () => {
      throw new ConnectivityError();
    });
    epssScores = await fetchEpssScores();
  } catch (error) {
    const isConnectivity = error instanceof ConnectivityError;
    await appendAuditEntry(db, {
      actorUserId: null,
      sessionId: null,
      sourceAddress: null,
      action: 'intel.egress_window_closed',
      targetType: 'vulnerability_data_import',
      targetId: importId,
      beforeState: null,
      afterState: { destinations: [NVD_API_HOST, EPSS_HOST], outcome: 'failed' },
      outcome: 'failure',
    });
    await db
      .updateTable('vulnerability_data_imports')
      .set({
        status: 'failed',
        failure_reason: isConnectivity
          ? 'no_connectivity'
          : String(error instanceof Error ? error.message : error),
      })
      .where('id', '=', importId)
      .execute();
    return;
  }

  // FEED-03/04: retain if known-exploited, or CVSS at/above the severity
  // floor, or EPSS at/above the exploit-probability threshold — never a
  // publication-year cutoff (FEED-01/FEED-05).
  const retained = nvdRecords.filter((r) => {
    const epss = epssScores.get(r.cveId) ?? null;
    return (
      r.knownExploited ||
      (r.cvss !== null && r.cvss.baseScore >= severityFloor) ||
      (epss !== null && epss >= exploitProbabilityThreshold)
    );
  });
  const discardedCount = nvdRecords.length - retained.length;

  let added = 0;
  let modified = 0;
  await db.transaction().execute(async (trx) => {
    for (const record of retained) {
      const epss = epssScores.get(record.cveId) ?? null;
      const existing = await trx
        .selectFrom('vulnerabilities')
        .select('id')
        .where('vuln_identifier', '=', record.cveId)
        .executeTakeFirst();
      const values = {
        cve_ids: [record.cveId],
        cwe_ids: record.cwe ? [record.cwe] : [],
        affected_cpes: JSON.stringify(record.cpes) as never,
        cvss_vector: record.cvss?.vector ?? null,
        cvss_version: record.cvss?.version ?? null,
        cvss_base_score: record.cvss ? String(record.cvss.baseScore) : (null as never),
        exploit_probability: epss === null ? null : (String(epss) as never),
        known_exploited: record.knownExploited,
        known_exploited_source: record.knownExploited ? 'nvd-cisa-kev-annotation' : null,
        published_at: record.publishedAt,
        modified_at: record.modifiedAt,
        description: record.description,
        data_import_id: importId,
      };
      if (existing) {
        await trx
          .updateTable('vulnerabilities')
          .set(values)
          .where('id', '=', existing.id)
          .execute();
        modified += 1;
      } else {
        await trx
          .insertInto('vulnerabilities')
          .values({ id: newId(), vuln_identifier: record.cveId, ...values })
          .execute();
        added += 1;
      }
    }

    const previous = await trx
      .selectFrom('vulnerability_data_imports')
      .select('id')
      .where('source_name', '=', 'nvd')
      .where('status', '=', 'applied')
      .where('id', '!=', importId)
      .execute();
    for (const p of previous) {
      await trx
        .updateTable('vulnerability_data_imports')
        .set({ superseded_by_id: importId })
        .where('id', '=', p.id)
        .execute();
    }

    await trx
      .updateTable('vulnerability_data_imports')
      .set({
        status: 'applied',
        record_counts: JSON.stringify({
          fetched: nvdRecords.length,
          added,
          modified,
          discarded: discardedCount,
          discardedByReason: { belowSeverityFloorAndNotExploited: discardedCount },
        }) as never,
        content_sha256: null,
      })
      .where('id', '=', importId)
      .execute();
  });

  await appendAuditEntry(db, {
    actorUserId: null,
    sessionId: null,
    sourceAddress: null,
    action: 'intel.egress_window_closed',
    targetType: 'vulnerability_data_import',
    targetId: importId,
    beforeState: { openedAt: windowStartedAt.toISOString() },
    afterState: {
      destinations: [NVD_API_HOST, EPSS_HOST],
      outcome: 'success',
      fetched: nvdRecords.length,
      added,
      modified,
      discarded: discardedCount,
    },
    outcome: 'success',
  });
}

/** Exported for the CPE-family-allowlist preview UI (UI-105) once that's built — kept here so the retention rule lives in exactly one place. */
export const INTEL_DEFAULTS = {
  severityFloor: DEFAULT_SEVERITY_FLOOR,
  exploitProbabilityThreshold: DEFAULT_EXPLOIT_PROBABILITY_THRESHOLD,
};
