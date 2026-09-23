import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { lookup as dnsLookup } from 'node:dns/promises';
import type { Kysely } from 'kysely';
import type { DB } from '@xenitex/db';
import {
  computeAssetRiskRating,
  confidenceTierFromScore,
  CURRENT_FINGERPRINT_VERSION,
  computeFingerprint,
  computeRiskScore,
  newId,
  riskBand,
  unitInterval,
  type AssetCriticality,
  type ExposureClassification,
  type Observation,
  type PacingConfig,
  type RawArtifact,
  type RiskFactors,
  type RiskScoringPolicy,
  type ScanPlanPreview,
  type Untrusted,
  isIpv4InCidr,
  isPrivateIpv4,
  candidateProductNames,
  matchServiceToCpe,
} from '@xenitex/domain';
import {
  matchConfigurationFindings,
  type ExecutionContext,
  type ScannerAdapter,
  type TargetOutcome,
} from '@xenitex/scanner-adapters';
import type { WorkerDependencies } from '../dependencies.js';

const BATCH_SIZE_CAP = 20;

/**
 * Upper bound on catalogue rows examined for one observed service. A very
 * common product (openssl, curl) can appear in hundreds of CVE entries;
 * this keeps one banner from turning into an unbounded scan of the
 * catalogue inside the pipeline.
 */
const CATALOGUE_CANDIDATE_CAP = 500;
const PAUSED_POLL_MS = 3000;

/**
 * Mirrors TcpConnectDiscoveryAdapter's own port lists per intrusiveness.
 * Used only to size the job timeout below; the adapter remains the single
 * source of truth for which ports are actually probed (SEC-12).
 */
const PORT_COUNT_BY_INTRUSIVENESS: Record<string, number> = {
  'passive-inventory': 1,
  safe: 23,
  standard: 80,
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function unwrap(value: Untrusted<string> | undefined): string | null {
  return value ? value.value : null;
}

/**
 * SAFE-02 second layer: scan_run_targets already excludes at plan/creation
 * time (apps/api/src/routes/scans.ts); this re-checks immediately before
 * dispatch in case a rule was added after the plan was materialised. Port-
 * and tag-type rules aren't enforced at this pre-scan, host-level stage yet
 * (a tag needs a resolved asset; a port exclusion needs reshaping the probed
 * port list) — a documented, deliberate gap, not a silent one.
 */
function findHostExclusionMatch(
  target: string,
  rules: readonly { id: string; rule_type: string; value: string }[],
): { id: string } | null {
  for (const rule of rules) {
    if (rule.rule_type === 'address' && rule.value === target) return { id: rule.id };
    if (rule.rule_type === 'range' && isIpv4InCidr(target, rule.value)) return { id: rule.id };
  }
  return null;
}

interface ExclusionRuleRow {
  id: string;
  rule_type: string;
  value: string;
}

/**
 * Re-read on EVERY batch, never once per run. The whole point of the second
 * layer is to catch a rule added after the plan was materialised — but the
 * rule set used to be loaded once, before the dispatch loop started, so an
 * operator who added an exclusion while a long scan was already running
 * (the exact situation the control exists for: "stop touching that host,
 * now") saw it ignored for the entire remainder of the run. One small
 * indexed query per batch of at most BATCH_SIZE_CAP hosts is not a cost
 * worth trading a safety control for.
 */
async function loadActiveExclusionRules(db: Kysely<DB>): Promise<ExclusionRuleRow[]> {
  return db
    .selectFrom('exclusion_rules')
    .select(['id', 'rule_type', 'value'])
    .where('is_active', '=', true)
    .execute();
}

/**
 * SAFE-01, enforced at dispatch as well as at plan time. The scan run names
 * the scope that authorised it; a target that is not inside that scope's
 * ranges or hostnames must not be probed, whatever put it in
 * scan_run_targets. This is the control that makes a corrupted or
 * hand-edited target row un-actionable rather than merely unlikely.
 */
function isTargetWithinScope(
  target: string,
  scope: { cidr_ranges: string[]; hostnames: string[] },
): boolean {
  if (scope.hostnames.includes(target)) return true;
  return scope.cidr_ranges.some((range) => isIpv4InCidr(target, range));
}

/**
 * SAFE-06: blackout windows, global (scope_id IS NULL) and per scope. A
 * running scan entering a window pauses cleanly BETWEEN hosts — which is
 * why this is checked at the top of the dispatch loop, where no probe is
 * in flight, rather than inside a batch.
 *
 * Recurrence (`is_recurring`/`rrule`) is not evaluated here: no RRULE
 * parser is bundled, and guessing at one would produce a control that
 * looks enforced and silently is not. Non-recurring windows — the shape
 * the panel actually creates — are enforced exactly.
 */
async function activeBlackoutWindow(
  db: Kysely<DB>,
  scopeId: string,
): Promise<{ id: string; name: string } | null> {
  const now = new Date();
  const row = await db
    .selectFrom('blackout_windows')
    .select(['id', 'name'])
    .where('is_recurring', '=', false)
    .where('starts_at', '<=', now)
    .where('ends_at', '>', now)
    .where((eb) => eb.or([eb('scope_id', '=', scopeId), eb('scope_id', 'is', null)]))
    .executeTakeFirst();
  return row ?? null;
}

async function ensureScannerAdapterRegistered(
  db: Kysely<DB>,
  adapter: ScannerAdapter,
): Promise<string> {
  const caps = adapter.capabilities();
  const existing = await db
    .selectFrom('scanner_adapters')
    .select('id')
    .where('adapter_key', '=', caps.adapterKey)
    .executeTakeFirst();
  if (existing) return existing.id;
  const id = newId();
  await db
    .insertInto('scanner_adapters')
    .values({
      id,
      adapter_key: caps.adapterKey,
      version: caps.version,
      fidelity_rating: String(caps.fidelityRating) as never,
      capabilities: JSON.stringify({
        supportedIntrusiveness: caps.supportedIntrusiveness,
      }) as never,
      is_enabled: true,
    })
    .execute();
  return id;
}

const IPV4_LITERAL = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;

/**
 * authorized_scopes.hostnames entries (SAFE-01) reach the adapter as plain
 * hostnames — `net.connect` resolves those itself for probing, but
 * asset_address_history.address is a Postgres `inet` column, which rejects
 * a bare hostname outright (observed as a real 22P02 crash the first time a
 * scope with a hostname entry actually ran, not a hypothetical). Resolve
 * once here and keep the hostname as a first-class AssetHostnameHistory
 * fact instead of silently discarding it.
 */
async function resolveTargetToIp(target: string): Promise<{ ip: string; hostname: string | null }> {
  if (IPV4_LITERAL.test(target)) return { ip: target, hostname: null };
  const { address } = await dnsLookup(target, { family: 4 });
  return { ip: address, hostname: target };
}

async function upsertHostnameHistory(
  db: Kysely<DB>,
  assetId: string,
  hostname: string,
): Promise<void> {
  const existing = await db
    .selectFrom('asset_hostname_history')
    .select('id')
    .where('asset_id', '=', assetId)
    .where('hostname', '=', hostname)
    .where('is_current', '=', true)
    .executeTakeFirst();
  if (existing) {
    await db
      .updateTable('asset_hostname_history')
      .set({ last_seen: new Date() })
      .where('id', '=', existing.id)
      .execute();
  } else {
    await db
      .insertInto('asset_hostname_history')
      .values({ id: newId(), asset_id: assetId, hostname, is_current: true })
      .execute();
  }
}

async function resolveOrCreateAsset(db: Kysely<DB>, target: string): Promise<string> {
  const { ip, hostname } = await resolveTargetToIp(target);
  const existing = await db
    .selectFrom('asset_address_history')
    .select('asset_id')
    .where('address', '=', ip as never)
    .where('is_current', '=', true)
    .executeTakeFirst();
  let assetId: string;
  if (existing) {
    assetId = existing.asset_id;
    await db
      .updateTable('assets')
      .set({ last_seen: new Date(), updated_at: new Date() })
      .where('id', '=', assetId)
      .execute();
    await db
      .updateTable('asset_address_history')
      .set({ last_seen: new Date() })
      .where('asset_id', '=', assetId)
      .where('address', '=', ip as never)
      .where('is_current', '=', true)
      .execute();
  } else {
    // ADR 0002: unresolved-identity observations get a provisional,
    // address-keyed asset — a TCP connect gives us no MAC/serial/machine-uuid
    // (MOD-05: "an address is never an identity", but it's all we have until
    // a credentialed or identity-bearing adapter exists).
    assetId = newId();
    await db
      .insertInto('assets')
      .values({
        id: assetId,
        exposure_classification: (isPrivateIpv4(ip) ? 'internal' : 'unknown') as never,
      })
      .execute();
    await db
      .insertInto('asset_address_history')
      .values({ id: newId(), asset_id: assetId, address: ip as never, is_current: true })
      .execute();
  }
  if (hostname) await upsertHostnameHistory(db, assetId, hostname);
  return assetId;
}

async function upsertAssetService(
  db: Kysely<DB>,
  assetId: string,
  port: number,
  protocol: string,
  serviceName: string | null,
  product: string | null,
  version: string | null,
): Promise<void> {
  const existing = await db
    .selectFrom('asset_services')
    .select('id')
    .where('asset_id', '=', assetId)
    .where('port', '=', port)
    .where('protocol', '=', protocol)
    .where('is_current', '=', true)
    .executeTakeFirst();
  if (existing) {
    await db
      .updateTable('asset_services')
      .set({
        service_name_untrusted: serviceName,
        product_untrusted: product,
        version_untrusted: version,
        last_seen: new Date(),
      })
      .where('id', '=', existing.id)
      .execute();
  } else {
    await db
      .insertInto('asset_services')
      .values({
        id: newId(),
        asset_id: assetId,
        port,
        protocol,
        service_name_untrusted: serviceName,
        product_untrusted: product,
        version_untrusted: version,
      })
      .execute();
  }
}

type IssueSeverity = 'info' | 'low' | 'medium' | 'high' | 'critical';

/** SCORE 2.3's 'informational' band maps to the DB/domain Issue.severity value 'info'. */
function severityFromRiskBand(band: ReturnType<typeof riskBand>): IssueSeverity {
  return band === 'informational' ? 'info' : band;
}

/**
 * docs/issues-scoring-dashboard-spec.md SCORE-02/MATCH-18: "never treat a
 * missing score as zero" — the multiplicative model makes this a hard
 * requirement, not just good practice: a literal 0 base zeroes the whole
 * score regardless of every other factor. A real per-finding-class base
 * table (SCORE-02's own "documented table") is deferred; these are
 * conservative, documented interim defaults for a real CVE that happens to
 * carry no CVSS at all (rare, but present in real NVD data).
 */
function fallbackCvssBase(knownExploited: boolean): { score: number; version: string } {
  return knownExploited
    ? { score: 7.0, version: 'no-cvss-known-exploited-default' }
    : { score: 5.0, version: 'no-cvss-default' };
}

async function recomputeAssetRiskRating(db: Kysely<DB>, assetId: string): Promise<void> {
  // MOD-10: only states representing unresolved work count toward the
  // asset's current exposure — an accepted-risk, false-positive, or
  // system-verified-resolved issue isn't "open" for rating purposes.
  const rows = await db
    .selectFrom('issues')
    .leftJoin('vulnerabilities', 'vulnerabilities.id', 'issues.vulnerability_id')
    .select(['issues.id as issue_id', 'issues.risk_score', 'vulnerabilities.known_exploited'])
    .where('issues.asset_id', '=', assetId)
    .where('issues.state', 'in', ['new', 'triaged', 'in_progress', 'reopened'])
    .execute();
  const result = computeAssetRiskRating(
    rows.map((r) => ({
      issueId: r.issue_id,
      riskScore: Number(r.risk_score),
      knownExploited: r.known_exploited ?? false,
    })),
  );
  await db
    .updateTable('assets')
    .set({ risk_rating: String(result.rating) as never, risk_band: result.band })
    .where('id', '=', assetId)
    .execute();
}

interface UpsertIssueInput {
  readonly assetId: string;
  readonly assetCriticality: AssetCriticality;
  readonly assetExposure: ExposureClassification;
  readonly observationRowId: string;
  readonly vulnerabilityRowId: string | null;
  readonly fingerprintVulnIdentifier: string;
  readonly port: number;
  readonly protocol: string | null;
  readonly service: string | null;
  readonly product: string | null;
  readonly version: string | null;
  /** null when the vulnerability catalogue row carries no CVSS at all — see fallbackCvssBase. */
  readonly cvssBaseScore: number | null;
  readonly cvssVersion: string | null;
  readonly exploitProbability: number | null;
  readonly knownExploited: boolean;
  readonly confidence: number;
  readonly riskPolicy: RiskScoringPolicy;
}

async function upsertIssue(db: Kysely<DB>, input: UpsertIssueInput): Promise<void> {
  const fingerprint = computeFingerprint({
    identityAnchor: input.assetId,
    vulnerabilityIdentifier: input.fingerprintVulnIdentifier,
    port: input.port,
    protocol: input.protocol,
  });

  const existing = await db
    .selectFrom('issues')
    .select(['id', 'state'])
    .where('fingerprint', '=', fingerprint)
    .where('fingerprint_version', '=', CURRENT_FINGERPRINT_VERSION)
    .executeTakeFirst();

  if (existing) {
    const now = new Date();
    // MOD-10/MOD-13. Seeing the same fingerprint again is fresh evidence
    // that the problem is still present, so an issue the system had
    // recorded as resolved — or that a user had marked mitigated pending
    // verification — must come back as `reopened`. Previously ONLY
    // `last_seen` moved, which meant a vulnerability that was fixed and
    // then regressed (a rollback, a re-image from an old template, a
    // package downgrade) stayed filed under `verified_resolved` forever
    // and never reappeared in anyone's queue. That is the single worst
    // failure mode this product can have: silently telling a customer a
    // live problem is closed.
    //
    // `false_positive` and `risk_accepted` are deliberately NOT reopened
    // here: those are human decisions governed by MOD-11's "until the
    // underlying evidence changes materially" and MOD-12's exception
    // expiry respectively, and re-observing the same evidence is not a
    // material change.
    const REOPEN_FROM: readonly string[] = ['mitigated', 'verified_resolved'];
    const shouldReopen = REOPEN_FROM.includes(existing.state);

    await db
      .updateTable('issues')
      .set(
        shouldReopen ? { last_seen: now, state: 'reopened', updated_at: now } : { last_seen: now },
      )
      .where('id', '=', existing.id)
      .execute();

    if (shouldReopen) {
      await db
        .insertInto('issue_state_history')
        .values({
          id: newId(),
          issue_id: existing.id,
          from_state: existing.state,
          to_state: 'reopened',
          // MOD-13: system-driven, so no actor — the same convention the
          // `verified_resolved_is_system_only` constraint encodes.
          actor_user_id: null,
          justification:
            'Reopened automatically: the same finding was observed again after it had been recorded as resolved.',
        })
        .execute();
    }

    await db
      .insertInto('issue_observations')
      .values({ issue_id: existing.id, observation_id: input.observationRowId })
      .onConflict((oc) => oc.columns(['issue_id', 'observation_id']).doNothing())
      .execute();

    // A reopened issue is open again, so it counts toward the asset's
    // rating (which the early return used to skip entirely).
    if (shouldReopen) await recomputeAssetRiskRating(db, input.assetId);
    return;
  }

  const usedFallbackBase = input.cvssBaseScore === null;
  const fallback = usedFallbackBase ? fallbackCvssBase(input.knownExploited) : null;
  const factors: RiskFactors = {
    normalisedCvssBaseScore: input.cvssBaseScore ?? fallback!.score,
    cvssVersionUsed: input.cvssVersion ?? fallback!.version,
    exploitProbability:
      input.exploitProbability === null ? null : unitInterval(input.exploitProbability),
    knownExploited: input.knownExploited,
    exposureClassification: input.assetExposure,
    assetCriticality: input.assetCriticality,
    confidenceTier: confidenceTierFromScore(unitInterval(input.confidence)),
  };
  const riskResult = computeRiskScore(factors, input.riskPolicy);

  const issueId = newId();
  await db
    .insertInto('issues')
    .values({
      id: issueId,
      fingerprint,
      fingerprint_version: CURRENT_FINGERPRINT_VERSION,
      asset_id: input.assetId,
      vulnerability_id: input.vulnerabilityRowId,
      port: input.port,
      protocol: input.protocol,
      service_untrusted: input.service,
      product_untrusted: input.product,
      version_untrusted: input.version,
      severity: severityFromRiskBand(riskResult.band),
      risk_score: String(riskResult.totalScore) as never,
      risk_score_policy_version: input.riskPolicy.version,
      confidence: String(input.confidence) as never,
      state: 'new',
    })
    .execute();
  await db
    .insertInto('issue_risk_score_snapshots')
    .values({
      id: newId(),
      issue_id: issueId,
      scoring_policy_version: input.riskPolicy.version,
      total_score: String(riskResult.totalScore) as never,
      factor_breakdown: JSON.stringify(riskResult.breakdown) as never,
      trigger: 'initial_score',
    })
    .execute();
  await db
    .insertInto('issue_observations')
    .values({ issue_id: issueId, observation_id: input.observationRowId })
    .execute();
  // PROF-04/DSH-16: recomputed whenever an issue affecting the asset is
  // created — a new open issue is the only thing that can change
  // computeAssetRiskRating's inputs on the create path (the early-return
  // "already exists" branch above only moves last_seen, never risk_score
  // or known_exploited, so it doesn't need this).
  await recomputeAssetRiskRating(db, input.assetId);
}

export interface CatalogueMatch {
  readonly vulnerabilityId: string;
  readonly vulnIdentifier: string;
  readonly confidence: number;
  readonly reasons: readonly string[];
  readonly explanation: string;
  readonly cvssBaseScore: number | null;
  readonly cvssVersion: string | null;
  readonly exploitProbability: number | null;
  readonly knownExploited: boolean;
}

/**
 * P2-08/MATCH-*. Matches an observed service against the real vulnerability
 * catalogue.
 *
 * Before this existed the pipeline compared services against five
 * hard-coded seed CVEs and nothing else, so the 7,000+ records the intel
 * importer had loaded — complete with CPEs, affected version ranges, EPSS
 * scores and KEV status — were never consulted, and every issue the
 * appliance produced carried `vulnerability_id IS NULL`. The product
 * imported vulnerability intelligence and then ignored it.
 *
 * The lookup is indexed by CPE product name (migration 0014) rather than
 * scanning the catalogue, and every candidate goes through the pure matcher
 * in packages/domain so the decision is testable in isolation from the
 * database.
 */
async function matchCatalogue(
  db: Kysely<DB>,
  observed: { product: string | null; serviceName: string | null; version: string | null },
): Promise<readonly CatalogueMatch[]> {
  const productNames = candidateProductNames(observed.product ?? observed.serviceName);
  if (productNames.length === 0) return [];

  const rows = await db
    .selectFrom('vulnerability_cpes')
    .innerJoin('vulnerabilities', 'vulnerabilities.id', 'vulnerability_cpes.vulnerability_id')
    .select([
      'vulnerability_cpes.vulnerability_id',
      'vulnerability_cpes.cpe',
      'vulnerability_cpes.version_range',
      'vulnerabilities.vuln_identifier',
      'vulnerabilities.cvss_base_score',
      'vulnerabilities.cvss_version',
      'vulnerabilities.exploit_probability',
      'vulnerabilities.known_exploited',
    ])
    .where('vulnerability_cpes.product', 'in', productNames)
    // Only application CPEs: an operating-system or hardware CPE cannot be
    // concluded from a single service banner.
    .where('vulnerability_cpes.part', '=', 'a')
    .limit(CATALOGUE_CANDIDATE_CAP)
    .execute();

  // A CVE can list several CPE entries; keep the strongest verdict per CVE
  // so the result does not depend on row order.
  const best = new Map<string, CatalogueMatch>();
  for (const row of rows) {
    const result = matchServiceToCpe(observed, {
      cpe: row.cpe,
      versionRange: row.version_range,
    });
    if (!result.matched) continue;
    const existing = best.get(row.vulnerability_id);
    if (existing && existing.confidence >= result.confidence) continue;
    best.set(row.vulnerability_id, {
      vulnerabilityId: row.vulnerability_id,
      vulnIdentifier: row.vuln_identifier,
      confidence: result.confidence,
      reasons: result.reasons,
      explanation: result.explanation,
      cvssBaseScore: row.cvss_base_score === null ? null : Number(row.cvss_base_score),
      cvssVersion: row.cvss_version,
      exploitProbability:
        row.exploit_probability === null ? null : Number(row.exploit_probability),
      knownExploited: row.known_exploited,
    });
  }

  return [...best.values()];
}

async function processObservations(
  db: Kysely<DB>,
  observations: readonly Observation[],
  scannerAdapterRowId: string,
  riskPolicy: RiskScoringPolicy | null,
): Promise<void> {
  for (const obs of observations) {
    try {
      const observationRowId = newId();
      await db
        .insertInto('observations')
        .values({
          id: observationRowId,
          scan_run_id: obs.scanRunId,
          scanner_adapter_id: scannerAdapterRowId,
          raw_artifact_id: obs.rawArtifactId,
          target_address: obs.targetAddress,
          target_port: obs.targetPort,
          target_protocol: obs.targetProtocol,
          extracted_attributes: JSON.stringify(obs.extractedAttributes) as never,
          untrusted_evidence: JSON.stringify(
            Object.fromEntries(Object.entries(obs.untrustedEvidence).map(([k, v]) => [k, v.value])),
          ) as never,
          observed_at: obs.observedAt as never,
        })
        .execute();

      const assetId = await resolveOrCreateAsset(db, obs.targetAddress);
      await db
        .updateTable('observations')
        .set({ resolved_asset_id: assetId })
        .where('id', '=', observationRowId)
        .execute();

      if (obs.targetPort === null || obs.targetProtocol === null) continue;

      const serviceName = unwrap(obs.untrustedEvidence.serviceName);
      const product = unwrap(obs.untrustedEvidence.product);
      const version = unwrap(obs.untrustedEvidence.version);
      const portState = (obs.extractedAttributes as Record<string, unknown>).portState;
      if (portState !== 'open') continue; // MOD-04/ANTI-07: closed/filtered ports are recorded as observations, never as issues

      await upsertAssetService(
        db,
        assetId,
        obs.targetPort,
        obs.targetProtocol,
        serviceName,
        product,
        version,
      );

      if (!riskPolicy) continue; // no active risk_scoring_policies row -- can't score responsibly, so no issue is created

      const asset = await db
        .selectFrom('assets')
        .select(['business_criticality', 'exposure_classification'])
        .where('id', '=', assetId)
        .executeTakeFirstOrThrow();

      for (const match of matchKnownVulnerabilities(product, serviceName, version)) {
        const vulnRow = await db
          .selectFrom('vulnerabilities')
          .selectAll()
          .where('vuln_identifier', '=', match.seed.vulnIdentifier)
          .executeTakeFirst();
        if (!vulnRow) continue; // seed migration (0010) not applied -- skip rather than fabricate a catalogue row at runtime
        await upsertIssue(db, {
          assetId,
          assetCriticality: asset.business_criticality,
          assetExposure: asset.exposure_classification,
          observationRowId,
          vulnerabilityRowId: vulnRow.id,
          fingerprintVulnIdentifier: match.seed.vulnIdentifier,
          port: obs.targetPort,
          protocol: obs.targetProtocol,
          service: serviceName,
          product,
          version,
          cvssBaseScore: vulnRow.cvss_base_score === null ? null : Number(vulnRow.cvss_base_score),
          cvssVersion: vulnRow.cvss_version,
          exploitProbability:
            vulnRow.exploit_probability === null ? null : Number(vulnRow.exploit_probability),
          knownExploited: vulnRow.known_exploited,
          // MOD-19: version-string inference is explicitly low confidence.
          confidence: 0.35,
          riskPolicy,
        });
      }

      for (const finding of matchConfigurationFindings(obs.targetPort, serviceName)) {
        await upsertIssue(db, {
          assetId,
          assetCriticality: asset.business_criticality,
          assetExposure: asset.exposure_classification,
          observationRowId,
          vulnerabilityRowId: null,
          fingerprintVulnIdentifier: finding.stableKey,
          port: obs.targetPort,
          protocol: obs.targetProtocol,
          service: serviceName,
          product,
          version,
          cvssBaseScore: finding.baseCvssEquivalent,
          cvssVersion: 'finding-class',
          exploitProbability: null,
          knownExploited: false,
          // Directly observed (the port is genuinely open), not an inference.
          confidence: 0.75,
          riskPolicy,
        });
      }
    } catch (error) {
      // One bad observation (a hostname that fails DNS resolution, an
      // unexpected banner, etc.) must not take the whole scan run down —
      // observed for real (an unresolvable authorized_scopes.hostnames entry
      // crashed the entire run before this was added). Recorded to the
      // worker's own logs, not the audit log (this is a pipeline fault, not a
      // user action per DATA-03).
      console.error(
        `worker: failed to process observation for ${obs.targetAddress}:${obs.targetPort ?? '-'}`,
        error,
      );
    }
  }
}

/**
 * 4.6/MOD-13. `verified_resolved` is set ONLY by a verification scan
 * result, never by a user — which meant that until this existed, the state
 * was unreachable: POST /verification-scans created a `verification_scans`
 * row and a scan run, the run executed, and the row sat at `pending`
 * forever. The customer's whole path for proving to themselves that a fix
 * worked terminated in nothing, and every mitigated issue stayed mitigated.
 *
 * The test is deliberately evidence-based rather than absence-based
 * guesswork: the issue is confirmed resolved only if this run produced
 * observations AND none of them re-attached to the issue's fingerprint. A
 * run that produced no observations at all (host down, adapter failure,
 * job timeout) proves nothing and resolves to `inconclusive` — reporting
 * "fixed" because we failed to look would be exactly the kind of false
 * assurance QA-00 forbids.
 */
async function resolveVerificationScans(db: Kysely<DB>, scanRunId: string): Promise<void> {
  const pending = await db
    .selectFrom('verification_scans')
    .select(['id', 'issue_id'])
    .where('scan_run_id', '=', scanRunId)
    .where('outcome', '=', 'pending')
    .execute();
  if (pending.length === 0) return;

  const observationCount = await db
    .selectFrom('observations')
    .select((eb) => eb.fn.countAll().as('count'))
    .where('scan_run_id', '=', scanRunId)
    .executeTakeFirstOrThrow();
  const runProducedEvidence = Number(observationCount.count) > 0;

  for (const verification of pending) {
    const reobserved = await db
      .selectFrom('issue_observations')
      .innerJoin('observations', 'observations.id', 'issue_observations.observation_id')
      .select('issue_observations.issue_id')
      .where('issue_observations.issue_id', '=', verification.issue_id)
      .where('observations.scan_run_id', '=', scanRunId)
      .executeTakeFirst();

    const outcome = !runProducedEvidence
      ? ('inconclusive' as const)
      : reobserved
        ? ('still_present' as const)
        : ('confirmed_resolved' as const);

    await db
      .updateTable('verification_scans')
      .set({ outcome, resolved_at: new Date() })
      .where('id', '=', verification.id)
      .where('outcome', '=', 'pending')
      .execute();

    if (outcome !== 'confirmed_resolved') continue;

    // Only promote from the states a verification is meaningful for. A
    // user may set `mitigated` (MOD-13); only the system promotes it. An
    // issue someone marked false_positive or risk_accepted in the meantime
    // is not quietly re-filed as resolved behind their decision.
    const issue = await db
      .selectFrom('issues')
      .select(['id', 'state', 'asset_id'])
      .where('id', '=', verification.issue_id)
      .executeTakeFirst();
    if (!issue) continue;
    const PROMOTABLE: readonly string[] = [
      'new',
      'triaged',
      'in_progress',
      'mitigated',
      'reopened',
    ];
    if (!PROMOTABLE.includes(issue.state)) continue;

    const now = new Date();
    await db
      .updateTable('issues')
      .set({ state: 'verified_resolved', last_verified_at: now, updated_at: now })
      .where('id', '=', issue.id)
      .execute();
    await db
      .insertInto('issue_state_history')
      .values({
        id: newId(),
        issue_id: issue.id,
        from_state: issue.state as never,
        to_state: 'verified_resolved',
        // System-only, per the verified_resolved_is_system_only constraint.
        actor_user_id: null,
        verification_scan_id: verification.id,
        justification:
          'Verification scan re-probed the target and no longer observed this finding.',
      })
      .execute();
    await recomputeAssetRiskRating(db, issue.asset_id);
  }
}

export async function processScanRun(
  scanRunId: string,
  deps: WorkerDependencies,
  jobWorkingDirectoryRoot: string,
): Promise<void> {
  const { db } = deps;
  const scanRun = await db
    .selectFrom('scan_runs')
    .selectAll()
    .where('id', '=', scanRunId)
    .executeTakeFirst();
  if (!scanRun) return;

  if (scanRun.status === 'queued') {
    await db
      .updateTable('scan_runs')
      .set({ status: 'running', started_at: new Date() })
      .where('id', '=', scanRunId)
      .execute();
  } else if (scanRun.status !== 'running') {
    return;
  }

  const profile = await db
    .selectFrom('scan_profiles')
    .selectAll()
    .where('id', '=', scanRun.profile_id)
    .executeTakeFirstOrThrow();
  // SAFE-01: the scope on record for this run, re-checked per target below.
  const scope = await db
    .selectFrom('authorized_scopes')
    .select(['id', 'cidr_ranges', 'hostnames'])
    .where('id', '=', scanRun.scope_id)
    .executeTakeFirstOrThrow();
  const riskPolicyRow = await db
    .selectFrom('risk_scoring_policies')
    .selectAll()
    .where('is_active', '=', true)
    .executeTakeFirst();
  const riskPolicy: RiskScoringPolicy | null = riskPolicyRow
    ? {
        version: riskPolicyRow.version,
        weights: riskPolicyRow.weights as never,
        isActive: true,
        createdAt: riskPolicyRow.created_at.toString() as never,
      }
    : null;

  const adapter = deps.adapters.get('network-discovery');
  if (!adapter) throw new Error('network-discovery adapter is not registered');
  const scannerAdapterRowId = await ensureScannerAdapterRegistered(db, adapter);

  const pacing = profile.pacing as unknown as PacingConfig;
  const batchSize = Math.max(1, Math.min(pacing.concurrentHosts ?? 10, BATCH_SIZE_CAP));

  // Adapters don't currently read the plan preview (see ScannerAdapter.execute
  // doc comment) -- a placeholder avoids a DB round trip for a value nothing
  // consumes yet. A future adapter that needs it should fetch it for real.
  const planPreview: ScanPlanPreview = {
    id: scanRun.plan_preview_id,
    scopeId: scanRun.scope_id as never,
    profileId: scanRun.profile_id as never,
    targetCount: 0,
    estimatedPacketVolume: 0,
    estimatedDurationSeconds: 0,
    excludedTargets: [],
    fragileDowngrades: [],
    confirmedByUserId: null,
    confirmedAt: null,
  };

  const workingDirectory = join(jobWorkingDirectoryRoot, scanRunId);
  await mkdir(workingDirectory, { recursive: true });

  try {
    for (;;) {
      const current = await db
        .selectFrom('scan_runs')
        .select('status')
        .where('id', '=', scanRunId)
        .executeTakeFirstOrThrow();
      if (current.status === 'aborted') break;
      if (current.status === 'paused') {
        await sleep(PAUSED_POLL_MS);
        continue;
      }
      if (current.status !== 'running') break;

      // SAFE-06, checked between hosts so nothing is mid-probe when we
      // stop. The run stays `running` rather than being marked `paused`:
      // `paused` is an operator decision recorded against an operator, and
      // overwriting it here would let an automatic window silently clear a
      // human's explicit pause when the window closed.
      const blackout = await activeBlackoutWindow(db, scanRun.scope_id);
      if (blackout) {
        await sleep(PAUSED_POLL_MS);
        continue;
      }

      const pendingTargets = await db
        .selectFrom('scan_run_targets')
        .select(['id', 'target_address'])
        .where('scan_run_id', '=', scanRunId)
        .where('status', '=', 'pending')
        .limit(batchSize)
        .execute();
      if (pendingTargets.length === 0) break;

      const exclusionRules = await loadActiveExclusionRules(db);
      const dispatchable: typeof pendingTargets = [];
      for (const t of pendingTargets) {
        const hit = findHostExclusionMatch(t.target_address, exclusionRules);
        if (hit) {
          await db
            .updateTable('scan_run_targets')
            .set({ status: 'excluded', excluded_by_rule_id: hit.id, completed_at: new Date() })
            .where('id', '=', t.id)
            .execute();
          continue;
        }
        if (!isTargetWithinScope(t.target_address, scope)) {
          // SAFE-01. Recorded as a distinct failure class, not as an
          // exclusion: an exclusion is an operator saying "never this
          // host", whereas this is the appliance refusing to act on a
          // target nothing ever authorised, which is a different — and
          // more alarming — thing for an operator to see in a run report.
          await db
            .updateTable('scan_run_targets')
            .set({
              status: 'failed',
              failure_class: 'out_of_scope',
              completed_at: new Date(),
            })
            .where('id', '=', t.id)
            .execute();
          console.error(
            `worker: refusing to dispatch ${t.target_address} for scan run ${scanRunId} — not within authorized scope ${scope.id}`,
          );
          continue;
        }
        dispatchable.push(t);
      }
      if (dispatchable.length === 0) continue;

      const targetRowIdByAddress = new Map(dispatchable.map((t) => [t.target_address, t.id]));
      const addresses = dispatchable.map((t) => t.target_address);
      await db
        .updateTable('scan_run_targets')
        .set({
          status: 'in_progress',
          started_at: new Date(),
          adapter_key: adapter.capabilities().adapterKey,
        })
        .where('id', 'in', [...targetRowIdByAddress.values()])
        .execute();

      // The budget must account for SAFE-04's packets-per-second ceiling,
      // which the adapter now actually applies: at a low pps the sweep is
      // deliberately slow, and a timeout derived only from per-probe
      // timeouts would cut off a scan that is pacing itself exactly as
      // configured. Derived from whichever bound is larger, with generous
      // headroom, so the timeout stays a backstop against a wedged adapter
      // rather than a second, accidental pacing limit.
      const probesInBatch =
        addresses.length * (PORT_COUNT_BY_INTRUSIVENESS[profile.intrusiveness] ?? 23);
      const pacingBoundMs =
        pacing.packetsPerSecond > 0 ? (probesInBatch / pacing.packetsPerSecond) * 1000 : 0;
      const context: ExecutionContext = {
        scanRunId,
        pacing,
        intrusiveness: profile.intrusiveness,
        workingDirectory,
        jobTimeoutMs: Math.max(
          30_000,
          Math.ceil(Math.max(pacing.timeoutMs * addresses.length, pacingBoundMs) * 2),
        ),
        outputSizeCapBytes: 50 * 1024 * 1024,
      };

      const outcomesByTarget = new Map<string, TargetOutcome>();
      let sharedArtifact: RawArtifact | undefined;
      for await (const outcome of adapter.execute(
        addresses,
        planPreview,
        context,
        () => undefined,
      )) {
        outcomesByTarget.set(outcome.target, outcome);
        // P2-02: a partial artifact is still evidence and is still worth
        // parsing — retaining results on failure is the point. Taking only
        // the `completed` branch meant a batch where every host hit the
        // job timeout produced no artifact row and no observations at all,
        // silently discarding the ports that HAD been probed.
        const artifact =
          outcome.status === 'completed' ? outcome.rawArtifact : outcome.partialArtifact;
        if (artifact) sharedArtifact = artifact;
      }

      if (sharedArtifact !== undefined) {
        const artifact = sharedArtifact;
        await db
          .insertInto('raw_artifacts')
          .values({
            id: artifact.id,
            scan_run_id: artifact.scanRunId,
            scanner_adapter_id: scannerAdapterRowId,
            blob_store_key: artifact.blobStoreKey,
            content_type: artifact.contentType,
            size_bytes: String(artifact.sizeBytes) as never,
            sha256: artifact.sha256,
            captured_at: artifact.capturedAt as never,
          })
          .onConflict((oc) => oc.column('id').doNothing())
          .execute();
        const observations = await adapter.parse(artifact);
        await processObservations(db, observations, scannerAdapterRowId, riskPolicy);
      }

      for (const [address, targetRowId] of targetRowIdByAddress) {
        const outcome = outcomesByTarget.get(address);
        if (!outcome || outcome.status === 'completed') {
          await db
            .updateTable('scan_run_targets')
            .set({ status: 'completed', completed_at: new Date() })
            .where('id', '=', targetRowId)
            .execute();
        } else {
          await db
            .updateTable('scan_run_targets')
            .set({
              status: 'failed',
              failure_class: outcome.failureClass,
              completed_at: new Date(),
            })
            .where('id', '=', targetRowId)
            .execute();
        }
      }
    }

    const finalStatus = await db
      .selectFrom('scan_runs')
      .select('status')
      .where('id', '=', scanRunId)
      .executeTakeFirstOrThrow();
    if (finalStatus.status === 'running') {
      const remaining = await db
        .selectFrom('scan_run_targets')
        .select((eb) => eb.fn.countAll().as('count'))
        .where('scan_run_id', '=', scanRunId)
        .where('status', '=', 'pending')
        .executeTakeFirstOrThrow();
      if (Number(remaining.count) === 0) {
        await db
          .updateTable('scan_runs')
          .set({ status: 'completed', completed_at: new Date() })
          .where('id', '=', scanRunId)
          .execute();
        await resolveVerificationScans(db, scanRunId);
      }
    }
  } finally {
    await rm(workingDirectory, { recursive: true, force: true });
  }
}
