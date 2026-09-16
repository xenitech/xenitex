import type { components } from '@xenitex/contracts';
import {
  computeAssetRiskRating,
  computeFingerprint,
  computeRiskScore,
  confidenceLabel,
  confidenceTierFromScore,
  unitInterval,
  type AssetCriticality,
  type ExposureClassification,
  type FingerprintInput,
  type RiskScoringPolicy as DomainRiskScoringPolicy,
  type UtcTimestamp,
} from '@xenitex/domain';
import type { Rng } from './rng.js';
import {
  CONFIG_ISSUE_TYPES,
  DOMAIN_SUFFIXES,
  HOSTNAME_PREFIXES,
  OS_LABELS,
  OWNER_TEAMS,
  TAGS,
  VENDOR_PRODUCTS,
} from './data-pools.js';

type Asset = components['schemas']['Asset'];
type Vulnerability = components['schemas']['Vulnerability'];
type Observation = components['schemas']['Observation'];
type RawArtifact = components['schemas']['RawArtifact'];
type ScanRun = components['schemas']['ScanRun'];
type ScanRunTarget = components['schemas']['ScanRunTarget'];
type AuthorizedScope = components['schemas']['AuthorizedScope'];
type ScanProfile = components['schemas']['ScanProfile'];
type ScannerAdapter = components['schemas']['ScannerAdapter'];
type Issue = components['schemas']['Issue'];
type ScoreFactorContribution = components['schemas']['ScoreFactorContribution'];
type RiskScoreSnapshot = components['schemas']['RiskScoreSnapshot'];
type IssueStateHistoryEntry = components['schemas']['IssueStateHistoryEntry'];
type Exception = components['schemas']['Exception'];
type VerificationScan = components['schemas']['VerificationScan'];
type RiskScoringWeights = components['schemas']['RiskScoringWeights'];

const NOW = Date.now();
const daysAgo = (days: number) => new Date(NOW - days * 86_400_000).toISOString();

interface ServiceSeed {
  readonly port: number;
  readonly protocol: string;
  readonly product: string;
}

function randomPrivateAddress(rng: Rng, index: number): string {
  // Deterministic-ish spread across RFC1918 space, indexed so addresses don't collide across assets.
  const block = index % 3;
  const third = Math.floor(index / 256) % 256;
  const fourth = index % 256;
  if (block === 0) return `10.${Math.floor(index / 65536) % 256}.${third}.${fourth}`;
  if (block === 1) return `172.${16 + (Math.floor(index / 256) % 16)}.${third}.${fourth}`;
  return `192.168.${third % 256}.${fourth}`;
}

function randomServices(rng: Rng): ServiceSeed[] {
  const commonPorts: [number, string][] = [
    [22, 'tcp'],
    [80, 'tcp'],
    [443, 'tcp'],
    [3306, 'tcp'],
    [5432, 'tcp'],
    [8080, 'tcp'],
    [8443, 'tcp'],
    [21, 'tcp'],
    [25, 'tcp'],
    [3389, 'tcp'],
  ];
  const n = rng.int(1, 5);
  const chosen = new Set<number>();
  const services: ServiceSeed[] = [];
  for (let i = 0; i < n; i++) {
    const [port, protocol] = rng.pick(commonPorts);
    if (chosen.has(port)) continue;
    chosen.add(port);
    services.push({ port, protocol, product: rng.pick(VENDOR_PRODUCTS) });
  }
  return services;
}

export interface AssetWithServices {
  readonly asset: Asset;
  readonly services: readonly ServiceSeed[];
  readonly primaryAddress: string;
}

export function generateAssets(rng: Rng, count: number): AssetWithServices[] {
  const results: AssetWithServices[] = [];
  for (let i = 0; i < count; i++) {
    const id = `asset-${i}`;
    const primaryAddress = randomPrivateAddress(rng, i);
    const services = randomServices(rng);
    const hasHostname = rng.boolean(0.7);
    const hostname = hasHostname
      ? `${rng.pick(HOSTNAME_PREFIXES)}-${i.toString(36)}.${rng.pick(DOMAIN_SUFFIXES)}`
      : null;
    const lifecycleState = rng.weightedPick([
      ['active', 90],
      ['inactive', 6],
      ['decommissioned', 3],
      ['merged', 1],
    ] as const);
    const firstSeenDays = rng.int(30, 400);
    const lastSeenDays = rng.int(0, Math.min(firstSeenDays, 14));

    const identityKeyCount = rng.int(1, 3);
    const identityKeyTypes = [
      'machine_uuid',
      'certificate_fingerprint',
      'serial_number',
      'mac_address',
      'fqdn',
    ] as const;
    const identityKeys = Array.from({ length: identityKeyCount }, (_, k) => ({
      keyType: identityKeyTypes[k % identityKeyTypes.length]!,
      keyValueUntrusted: rng.uuid(),
      sourceObservationId: null,
      confidence: unitInterval(k === 0 ? 0.95 : rng.float() * 0.6 + 0.3),
      firstSeen: daysAgo(firstSeenDays),
      lastSeen: daysAgo(lastSeenDays),
      isActive: true,
    }));

    const asset: Asset = {
      id,
      lifecycleState,
      mergedIntoAssetId: null,
      identityKeys,
      addresses: [
        {
          address: primaryAddress,
          firstSeen: daysAgo(firstSeenDays),
          lastSeen: daysAgo(lastSeenDays),
          isCurrent: true,
        },
      ],
      hostnames: hostname
        ? [
            {
              hostnameUntrusted: hostname,
              firstSeen: daysAgo(firstSeenDays),
              lastSeen: daysAgo(lastSeenDays),
              isCurrent: true,
            },
          ]
        : [],
      osInference: rng.boolean(0.85)
        ? {
            labelUntrusted: rng.pick(OS_LABELS),
            confidence: unitInterval(0.5 + rng.float() * 0.45),
          }
        : null,
      services: services.map((s) => ({
        port: s.port,
        protocol: s.protocol,
        serviceNameUntrusted: s.product,
        productUntrusted: s.product,
        versionUntrusted: `${rng.int(1, 9)}.${rng.int(0, 20)}.${rng.int(0, 9)}`,
        firstSeen: daysAgo(firstSeenDays),
        lastSeen: daysAgo(lastSeenDays),
        isCurrent: true,
      })),
      ownerTeam: rng.pick(OWNER_TEAMS),
      businessCriticality: rng.weightedPick([
        ['low', 30],
        ['medium', 40],
        ['high', 22],
        ['critical', 8],
      ] as const),
      exposureClassification: rng.weightedPick([
        ['internal', 50],
        ['dmz', 18],
        ['external', 15],
        ['isolated', 7],
        ['unknown', 10],
      ] as const),
      tags: Array.from(new Set(Array.from({ length: rng.int(0, 3) }, () => rng.pick(TAGS)))),
      isFragile: rng.boolean(0.04),
      firstSeen: daysAgo(firstSeenDays),
      lastSeen: daysAgo(lastSeenDays),
      // Patched to the real computed value once issues exist for this asset
      // (docs/issues-scoring-dashboard-spec.md SCORE 2.4) — see
      // fixtures/index.ts's post-pass, same mutation pattern already used
      // there for Issue.exceptionId.
      riskRating: null,
      riskBand: null,
    };
    results.push({ asset, services, primaryAddress });
  }
  return results;
}

export interface ScanRunBundle {
  readonly scanRuns: ScanRun[];
  readonly scanRunTargets: ScanRunTarget[];
  readonly rawArtifacts: RawArtifact[];
}

export function generateScanRuns(
  rng: Rng,
  count: number,
  scopes: readonly AuthorizedScope[],
  profiles: readonly ScanProfile[],
  adapters: readonly ScannerAdapter[],
  assetsByScope: readonly (readonly AssetWithServices[])[],
  userIds: readonly string[],
): ScanRunBundle {
  const scanRuns: ScanRun[] = [];
  const scanRunTargets: ScanRunTarget[] = [];
  const rawArtifacts: RawArtifact[] = [];

  for (let i = 0; i < count; i++) {
    const scopeIndex = i % scopes.length;
    const scope = scopes[scopeIndex]!;
    const profile = rng.weightedPick([
      [profiles[1]!, 80],
      [profiles[0]!, 15],
      [profiles[2]!, 5],
    ] as const);
    const status = rng.weightedPick([
      ['completed', 85],
      ['running', 5],
      ['queued', 3],
      ['paused', 3],
      ['aborted', 2],
      ['failed', 2],
    ] as const);
    const queuedDaysAgo = rng.int(1, 180);
    const id = `scanrun-${i}`;
    const assetsInScope = assetsByScope[scopeIndex] ?? [];
    const targetsTotal = Math.min(assetsInScope.length, rng.int(20, 300));

    scanRuns.push({
      id,
      planPreviewId: `planpreview-${i}`,
      scopeId: scope.id,
      profileId: profile.id,
      initiatedByUserId: rng.boolean(0.7) ? rng.pick(userIds) : null,
      status,
      correlationId: `corr-${id}`,
      queuedAt: daysAgo(queuedDaysAgo),
      startedAt: status === 'queued' ? null : daysAgo(queuedDaysAgo - 0.01),
      completedAt:
        status === 'completed' || status === 'aborted' || status === 'failed'
          ? daysAgo(queuedDaysAgo - 0.05)
          : null,
      abortedByUserId: status === 'aborted' ? rng.pick(userIds) : null,
      targetsTotal,
      targetsCompleted:
        status === 'completed' ? targetsTotal : Math.floor(targetsTotal * rng.float()),
    });

    for (const adapter of adapters) {
      rawArtifacts.push({
        id: `artifact-${id}-${adapter.adapterKey}`,
        scanRunId: id,
        scannerAdapterKey: adapter.adapterKey,
        contentType:
          adapter.adapterKey === 'network-discovery' ? 'application/xml' : 'application/json',
        sizeBytes: rng.int(2_000, 500_000),
        sha256: rng.uuid().replaceAll('-', ''),
        capturedAt: daysAgo(queuedDaysAgo - 0.02),
      });
    }

    const sampled = sampleWithoutReplacement(rng, assetsInScope, targetsTotal);
    for (const { primaryAddress } of sampled) {
      const targetStatus = rng.weightedPick([
        ['completed', 90],
        ['excluded', 4],
        ['skipped_blackout', 2],
        ['skipped_fragile_downgrade', 2],
        ['failed', 2],
      ] as const);
      scanRunTargets.push({
        id: `${id}-target-${primaryAddress}`,
        scanRunId: id,
        targetAddress: primaryAddress,
        targetPort: null,
        status: targetStatus,
        excludedByRuleId: targetStatus === 'excluded' ? 'excl-global-tag' : null,
      });
    }
  }

  return { scanRuns, scanRunTargets, rawArtifacts };
}

function sampleWithoutReplacement<T>(rng: Rng, items: readonly T[], n: number): T[] {
  if (n >= items.length) return [...items];
  const pool = [...items];
  const result: T[] = [];
  for (let i = 0; i < n && pool.length > 0; i++) {
    const idx = rng.int(0, pool.length - 1);
    result.push(pool[idx]!);
    pool.splice(idx, 1);
  }
  return result;
}

export function generateObservations(
  rng: Rng,
  totalCount: number,
  assetsWithServices: readonly AssetWithServices[],
  scanRuns: readonly ScanRun[],
  rawArtifacts: readonly RawArtifact[],
  adapters: readonly ScannerAdapter[],
): { observations: Observation[]; observationIdsByAssetId: Map<string, string[]> } {
  const observations: Observation[] = [];
  const observationIdsByAssetId = new Map<string, string[]>();
  const eligibleRuns = scanRuns.filter((r) => r.status === 'completed' || r.status === 'running');
  const runsToUse = eligibleRuns.length > 0 ? eligibleRuns : scanRuns;
  const artifactsByRun = new Map<string, RawArtifact[]>();
  for (const artifact of rawArtifacts) {
    const list = artifactsByRun.get(artifact.scanRunId) ?? [];
    list.push(artifact);
    artifactsByRun.set(artifact.scanRunId, list);
  }

  for (let i = 0; i < totalCount; i++) {
    const withServices = assetsWithServices[i % assetsWithServices.length]!;
    const run = runsToUse[i % runsToUse.length]!;
    const adapter = adapters[i % adapters.length]!;
    const artifact = (artifactsByRun.get(run.id) ?? rawArtifacts)[0] ?? rawArtifacts[0]!;
    const service = withServices.services.length > 0 ? rng.pick(withServices.services) : null;
    const id = `obs-${i}`;

    observations.push({
      id,
      scanRunId: run.id,
      scannerAdapterKey: adapter.adapterKey,
      scannerAdapterVersion: adapter.version,
      rawArtifactId: artifact.id,
      targetAddress: withServices.primaryAddress,
      targetPort: service?.port ?? null,
      targetProtocol: service?.protocol ?? null,
      resolvedAssetId: withServices.asset.id,
      extractedAttributes: service ? { port: service.port, state: 'open' } : { state: 'host_up' },
      untrustedEvidence: service
        ? { banner: `${service.product}/${rng.int(1, 9)}.${rng.int(0, 20)}` }
        : { pingResponse: 'icmp_echo_reply' },
      observedAt: run.completedAt ?? run.startedAt ?? run.queuedAt,
    });

    const list = observationIdsByAssetId.get(withServices.asset.id) ?? [];
    list.push(id);
    observationIdsByAssetId.set(withServices.asset.id, list);
  }

  return { observations, observationIdsByAssetId };
}

export interface IssueBundle {
  readonly issues: Issue[];
  readonly riskScoreSnapshots: RiskScoreSnapshot[];
  readonly issueStateHistory: IssueStateHistoryEntry[];
  readonly issueBreakdownById: Map<string, ScoreFactorContribution[]>;
}

/** Denormalisation source for Issue.assetLabelUntrusted — current hostname, falling back to current (or first) address. */
function assetLabel(asset: Asset): string {
  const hostname = asset.hostnames.find((h) => h.isCurrent) ?? asset.hostnames[0];
  if (hostname) return hostname.hostnameUntrusted;
  const address = asset.addresses.find((a) => a.isCurrent) ?? asset.addresses[0];
  return address?.address ?? 'unknown';
}

/**
 * docs/issues-scoring-dashboard-spec.md SCORE-02: real CVSS-linked issues
 * always have a base (real or fallback — see fallbackCvssBase), so severity
 * is always derived from the computed risk band, never a bare CVSS lookup
 * with its own 'medium' default guess.
 */
function severityFromBand(band: ReturnType<typeof computeRiskScore>['band']): Issue['severity'] {
  return band === 'informational' ? 'info' : band;
}

/** Mirrors apps/worker/src/pipeline/process-scan-run.ts's fallbackCvssBase exactly — see that function's comment for why a literal 0 base is never valid input here. */
function fallbackCvssBase(knownExploited: boolean): { score: number; version: string } {
  return knownExploited
    ? { score: 7.0, version: 'no-cvss-known-exploited-default' }
    : { score: 5.0, version: 'no-cvss-default' };
}

/**
 * Delegates to packages/domain's `computeRiskScore` — the same tested
 * implementation the real API/worker use (docs/issues-scoring-dashboard-spec.md
 * SCORE 2.2) — so the mock server's scores and "why this score" breakdowns
 * are never a second, drift-prone reimplementation of the scoring function.
 */
function scoreIssue(
  cvssBaseScore: number | null,
  cvssVersion: string | null,
  exploitProbability: number | null,
  knownExploited: boolean,
  exposure: ExposureClassification,
  criticality: AssetCriticality,
  confidence: number,
  weights: RiskScoringWeights,
  policyVersion: number,
): { totalScore: number; band: ReturnType<typeof computeRiskScore>['band']; breakdown: ScoreFactorContribution[] } {
  const policy: DomainRiskScoringPolicy = {
    version: policyVersion,
    weights,
    isActive: true,
    createdAt: new Date(0).toISOString() as UtcTimestamp,
  };
  const fallback = cvssBaseScore === null ? fallbackCvssBase(knownExploited) : null;
  const result = computeRiskScore(
    {
      normalisedCvssBaseScore: cvssBaseScore ?? fallback!.score,
      cvssVersionUsed: cvssVersion ?? fallback!.version,
      exploitProbability: exploitProbability === null ? null : unitInterval(exploitProbability),
      knownExploited,
      exposureClassification: exposure,
      assetCriticality: criticality,
      confidenceTier: confidenceTierFromScore(unitInterval(confidence)),
    },
    policy,
  );
  return {
    totalScore: Math.round(result.totalScore * 100) / 100,
    band: result.band,
    breakdown: result.breakdown.map((row) => ({ ...row })),
  };
}

export function generateIssues(
  rng: Rng,
  totalCount: number,
  assetsWithServices: readonly AssetWithServices[],
  vulnerabilities: readonly Vulnerability[],
  observationIdsByAssetId: Map<string, string[]>,
  userIds: readonly string[],
  weights: RiskScoringWeights,
  policyVersion: number,
): IssueBundle {
  const issues: Issue[] = [];
  const riskScoreSnapshots: RiskScoreSnapshot[] = [];
  const issueStateHistory: IssueStateHistoryEntry[] = [];
  const issueBreakdownById = new Map<string, ScoreFactorContribution[]>();
  const states = [
    'new',
    'triaged',
    'in_progress',
    'mitigated',
    'verified_resolved',
    'reopened',
    'false_positive',
    'risk_accepted',
  ] as const;

  for (let i = 0; i < totalCount; i++) {
    const { asset, services } = assetsWithServices[i % assetsWithServices.length]!;
    const hasVuln = rng.boolean(0.8);
    const vuln = hasVuln ? vulnerabilities[i % vulnerabilities.length]! : null;
    const service = services.length > 0 ? rng.pick(services) : null;
    const configType = !hasVuln ? rng.pick(CONFIG_ISSUE_TYPES) : null;

    const confidence = unitInterval(hasVuln ? 0.5 + rng.float() * 0.45 : 0.3 + rng.float() * 0.4);
    const { totalScore, band, breakdown } = scoreIssue(
      vuln?.cvssBaseScore ?? null,
      vuln?.cvssVersion ?? null,
      vuln?.exploitProbability ?? null,
      vuln?.knownExploited ?? false,
      asset.exposureClassification,
      asset.businessCriticality,
      confidence,
      weights,
      policyVersion,
    );

    const fingerprintInput: FingerprintInput = {
      identityAnchor: asset.identityKeys[0]?.keyValueUntrusted ?? asset.addresses[0]!.address,
      vulnerabilityIdentifier: vuln?.vulnIdentifier ?? configType?.key ?? null,
      port: service?.port ?? null,
      protocol: service?.protocol ?? null,
    };
    const fingerprint = computeFingerprint(fingerprintInput);

    const state = rng.weightedPick([
      ['new', 25],
      ['triaged', 20],
      ['in_progress', 15],
      ['mitigated', 10],
      ['verified_resolved', 12],
      ['reopened', 3],
      ['false_positive', 8],
      ['risk_accepted', 7],
    ] as const);

    const candidateObservations = observationIdsByAssetId.get(asset.id) ?? [];
    const contributingObservationIds = sampleWithoutReplacement(
      rng,
      candidateObservations,
      Math.min(candidateObservations.length, rng.int(1, 3)),
    );

    const firstSeenDays = rng.int(5, 300);
    const lastSeenDays = rng.int(0, Math.min(firstSeenDays, 10));
    const id = `issue-${i}`;

    const issue: Issue = {
      id,
      fingerprint,
      fingerprintVersion: 1,
      assetId: asset.id,
      title: vuln?.title ?? configType?.label ?? 'Unclassified issue',
      primaryCveId: vuln?.cveIds[0] ?? null,
      assetLabelUntrusted: assetLabel(asset),
      vulnerabilityId: vuln?.id ?? null,
      port: service?.port ?? null,
      protocol: service?.protocol ?? null,
      serviceUntrusted: service?.product ?? null,
      productUntrusted: service?.product ?? null,
      versionUntrusted: service ? `${rng.int(1, 9)}.${rng.int(0, 20)}.${rng.int(0, 9)}` : null,
      severity: severityFromBand(band),
      riskScore: totalScore,
      riskScorePolicyVersion: policyVersion,
      confidence,
      confidenceLabel: confidenceLabel(confidence),
      state,
      contributingObservationIds,
      ownerUserId: rng.boolean(0.6) ? rng.pick(userIds) : null,
      dueDate:
        state === 'verified_resolved' || state === 'false_positive'
          ? null
          : daysAgo(-rng.int(-30, 60)),
      exceptionId: null,
      firstSeen: daysAgo(firstSeenDays),
      lastSeen: daysAgo(lastSeenDays),
      lastVerifiedAt: state === 'verified_resolved' ? daysAgo(lastSeenDays) : null,
    };
    issues.push(issue);
    issueBreakdownById.set(id, breakdown);

    riskScoreSnapshots.push({
      id: `snapshot-${id}-1`,
      issueId: id,
      policyVersion,
      totalScore,
      breakdown,
      trigger: 'initial_score',
      computedAt: daysAgo(firstSeenDays),
    });

    if (state !== 'new') {
      issueStateHistory.push({
        id: `history-${id}-1`,
        issueId: id,
        fromState: 'new',
        toState: state,
        actorUserId: state === 'verified_resolved' ? null : rng.pick(userIds),
        reasonCode:
          state === 'false_positive'
            ? rng.pick([
                'not_applicable_environment',
                'patched_not_reflected',
                'false_signature_match',
              ])
            : null,
        justification:
          state === 'false_positive'
            ? 'Reviewed and confirmed not applicable to this environment.'
            : null,
        verificationScanId: null,
        transitionedAt: daysAgo(lastSeenDays),
      });
    }
    void states; // referenced for documentation of the full enum considered above
  }

  return { issues, riskScoreSnapshots, issueStateHistory, issueBreakdownById };
}

/**
 * docs/issues-scoring-dashboard-spec.md SCORE 2.4/SCORE-06/07/08. Mutates
 * each asset in place (same pattern as generateExceptions's issuePatches
 * below) since assets are generated before the issues that determine their
 * rating exist yet.
 */
export function applyAssetRiskRatings(
  assets: readonly Asset[],
  issues: readonly Issue[],
  vulnerabilities: readonly Vulnerability[],
): void {
  const knownExploitedByVulnId = new Map(vulnerabilities.map((v) => [v.id, v.knownExploited]));
  const openIssuesByAssetId = new Map<string, { issueId: string; riskScore: number; knownExploited: boolean }[]>();
  for (const issue of issues) {
    if (!['new', 'triaged', 'in_progress', 'reopened'].includes(issue.state)) continue;
    const list = openIssuesByAssetId.get(issue.assetId) ?? [];
    list.push({
      issueId: issue.id,
      riskScore: issue.riskScore,
      knownExploited: issue.vulnerabilityId
        ? (knownExploitedByVulnId.get(issue.vulnerabilityId) ?? false)
        : false,
    });
    openIssuesByAssetId.set(issue.assetId, list);
  }
  for (const asset of assets) {
    const result = computeAssetRiskRating(openIssuesByAssetId.get(asset.id) ?? []);
    (asset as { riskRating: number | null }).riskRating = openIssuesByAssetId.has(asset.id)
      ? result.rating
      : null;
    (asset as { riskBand: string | null }).riskBand = openIssuesByAssetId.has(asset.id)
      ? result.band
      : null;
  }
}

export function generateExceptions(
  rng: Rng,
  issues: readonly Issue[],
  userIds: readonly string[],
): { exceptions: Exception[]; issuePatches: Map<string, string> } {
  const exceptions: Exception[] = [];
  const issuePatches = new Map<string, string>();
  const riskAccepted = issues.filter((i) => i.state === 'risk_accepted');
  riskAccepted.forEach((issue, i) => {
    const requestedBy = rng.pick(userIds);
    const approver = rng.pick(userIds.filter((u) => u !== requestedBy));
    const id = `exception-${i}`;
    exceptions.push({
      id,
      issueId: issue.id,
      requestedBy,
      requestedAt: daysAgo(rng.int(5, 60)),
      justification:
        'Compensating network segmentation control in place; remediation scheduled for next maintenance window.',
      approverUserId: approver,
      approvedAt: daysAgo(rng.int(1, 4)),
      expiresAt: daysAgo(-rng.int(30, 300)),
      status: 'approved',
    });
    issuePatches.set(issue.id, id);
  });
  return { exceptions, issuePatches };
}

export function generateVerificationScans(
  rng: Rng,
  issues: readonly Issue[],
  scanRuns: readonly ScanRun[],
): VerificationScan[] {
  const candidates = issues.filter(
    (i) => i.state === 'verified_resolved' || i.state === 'in_progress',
  );
  return sampleWithoutReplacement(rng, candidates, Math.min(candidates.length, 150)).map(
    (issue, i) => ({
      id: `verification-${i}`,
      issueId: issue.id,
      scanRunId: rng.pick(scanRuns).id,
      requestedBy: null,
      requestedAt: daysAgo(rng.int(1, 20)),
      outcome:
        issue.state === 'verified_resolved'
          ? 'confirmed_resolved'
          : rng.pick(['pending', 'still_present', 'inconclusive'] as const),
      resolvedAt: issue.state === 'verified_resolved' ? daysAgo(rng.int(0, 5)) : null,
    }),
  );
}
