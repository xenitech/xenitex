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
} from '@xenitex/domain';
import {
  matchConfigurationFindings,
  matchKnownVulnerabilities,
  type ExecutionContext,
  type ScannerAdapter,
  type TargetOutcome,
} from '@xenitex/scanner-adapters';
import type { WorkerDependencies } from '../dependencies.js';
import { isIpInCidr, isPrivateIpv4 } from '../lib/ip-match.js';

const BATCH_SIZE_CAP = 20;
const PAUSED_POLL_MS = 3000;

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
    if (rule.rule_type === 'range' && isIpInCidr(target, rule.value)) return { id: rule.id };
  }
  return null;
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
    // MOD-11/MOD-12/MOD-13: a triage decision (false positive, risk
    // accepted, or a system-verified resolution) is never silently
    // overturned by seeing the same fingerprint again — only last_seen moves.
    await db
      .updateTable('issues')
      .set({ last_seen: new Date() })
      .where('id', '=', existing.id)
      .execute();
    await db
      .insertInto('issue_observations')
      .values({ issue_id: existing.id, observation_id: input.observationRowId })
      .onConflict((oc) => oc.columns(['issue_id', 'observation_id']).doNothing())
      .execute();
    return;
  }

  const usedFallbackBase = input.cvssBaseScore === null;
  const fallback = usedFallbackBase ? fallbackCvssBase(input.knownExploited) : null;
  const factors: RiskFactors = {
    normalisedCvssBaseScore: input.cvssBaseScore ?? fallback!.score,
    cvssVersionUsed: input.cvssVersion ?? fallback!.version,
    exploitProbability: input.exploitProbability === null ? null : unitInterval(input.exploitProbability),
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
  const exclusionRules = await db
    .selectFrom('exclusion_rules')
    .select(['id', 'rule_type', 'value'])
    .where('is_active', '=', true)
    .execute();
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

      const pendingTargets = await db
        .selectFrom('scan_run_targets')
        .select(['id', 'target_address'])
        .where('scan_run_id', '=', scanRunId)
        .where('status', '=', 'pending')
        .limit(batchSize)
        .execute();
      if (pendingTargets.length === 0) break;

      const dispatchable: typeof pendingTargets = [];
      for (const t of pendingTargets) {
        const hit = findHostExclusionMatch(t.target_address, exclusionRules);
        if (hit) {
          await db
            .updateTable('scan_run_targets')
            .set({ status: 'excluded', excluded_by_rule_id: hit.id, completed_at: new Date() })
            .where('id', '=', t.id)
            .execute();
        } else {
          dispatchable.push(t);
        }
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

      const context: ExecutionContext = {
        scanRunId,
        pacing,
        intrusiveness: profile.intrusiveness,
        workingDirectory,
        jobTimeoutMs: Math.max(30_000, pacing.timeoutMs * addresses.length),
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
        if (outcome.status === 'completed') sharedArtifact = outcome.rawArtifact;
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
      }
    }
  } finally {
    await rm(workingDirectory, { recursive: true, force: true });
  }
}
