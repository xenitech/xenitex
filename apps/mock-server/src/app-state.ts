import type { components } from '@xenitex/contracts';
import { Collection } from './store.js';
import { generateFixtures, type Fixtures } from './fixtures/index.js';
import type { MockServerConfig } from './config.js';

type Issue = components['schemas']['Issue'];
type Asset = components['schemas']['Asset'];
type ScanRun = components['schemas']['ScanRun'];

function groupBy<T, K>(items: readonly T[], key: (item: T) => K): Map<K, T[]> {
  const map = new Map<K, T[]>();
  for (const item of items) {
    const k = key(item);
    const list = map.get(k);
    if (list) list.push(item);
    else map.set(k, [item]);
  }
  return map;
}

/**
 * Wraps the generated Fixtures into mutable Collections (so handlers can
 * create/patch/delete during a running dev session) plus the sorted arrays
 * and grouping indices every list/detail handler needs. Built once at
 * startup — PERF-01 volumes make this a few hundred ms, not a per-request cost.
 */
export class AppState {
  readonly fixtures: Fixtures;
  readonly config: MockServerConfig;

  readonly users: Collection<components['schemas']['User']>;
  readonly assets: Collection<Asset>;
  readonly issues: Collection<Issue>;
  readonly observations: Collection<components['schemas']['Observation']>;
  readonly vulnerabilities: Collection<components['schemas']['Vulnerability']>;
  readonly scanRuns: Collection<ScanRun>;
  readonly scanRunTargets: Collection<components['schemas']['ScanRunTarget']>;
  readonly rawArtifacts: Collection<components['schemas']['RawArtifact']>;
  readonly exceptions: Collection<components['schemas']['Exception']>;
  readonly authorizedScopes: Collection<components['schemas']['AuthorizedScope']>;
  readonly exclusionRules: Collection<components['schemas']['ExclusionRule']>;
  readonly scanProfiles: Collection<components['schemas']['ScanProfile']>;
  readonly blackoutWindows: Collection<components['schemas']['BlackoutWindow']>;
  readonly scanSchedules: Collection<components['schemas']['ScanSchedule']>;
  readonly assetGroups: Collection<components['schemas']['AssetGroup']>;
  readonly savedViews: Collection<components['schemas']['SavedView']>;
  readonly notificationChannels: Collection<components['schemas']['NotificationChannel']>;
  readonly reports: Collection<components['schemas']['Report']>;
  readonly verificationScans: Collection<components['schemas']['VerificationScan']>;
  readonly backupRecords: Collection<components['schemas']['BackupRecord']>;
  readonly fragileDeviceRules: Collection<components['schemas']['FragileDeviceRule']>;
  readonly featureFlags: Collection<components['schemas']['FeatureFlag'] & { id: string }>;
  readonly retentionPolicies: Collection<components['schemas']['RetentionPolicy'] & { id: string }>;

  organizationSettings: components['schemas']['OrganizationSettings'];
  pacingCeilings: components['schemas']['PacingCeilings'];
  readonly riskScoringPolicies: components['schemas']['RiskScoringPolicy'][];
  readonly slaPolicies: components['schemas']['SlaPolicy'][];
  readonly scannerAdapters: components['schemas']['ScannerAdapter'][];
  readonly vulnerabilityDataImports: components['schemas']['VulnerabilityDataImport'][];
  readonly notificationEvents: components['schemas']['NotificationEvent'][];
  readonly auditEntries: components['schemas']['AuditEntry'][];
  readonly globalStopEvents: components['schemas']['GlobalStopEvent'][];

  readonly issueBreakdownById: Map<string, components['schemas']['ScoreFactorContribution'][]>;
  readonly riskScoreSnapshotsByIssueId: Map<string, components['schemas']['RiskScoreSnapshot'][]>;
  readonly issueStateHistoryByIssueId: Map<
    string,
    components['schemas']['IssueStateHistoryEntry'][]
  >;
  readonly verificationScansByIssueId: Map<string, components['schemas']['VerificationScan'][]>;
  readonly issuesByAssetId: Map<string, Issue[]>;
  readonly scanRunTargetsByRunId: Map<string, components['schemas']['ScanRunTarget'][]>;
  readonly rawArtifactsByRunId: Map<string, components['schemas']['RawArtifact'][]>;
  readonly scanRunIdsByAssetId: Map<string, Set<string>>;

  constructor(config: MockServerConfig) {
    this.config = config;
    const fixtures = generateFixtures(config);
    this.fixtures = fixtures;

    this.users = new Collection(fixtures.users);
    this.assets = new Collection(fixtures.assets);
    this.issues = new Collection(fixtures.issues);
    this.observations = new Collection(fixtures.observations);
    this.vulnerabilities = new Collection(fixtures.vulnerabilities);
    this.scanRuns = new Collection(fixtures.scanRuns);
    this.scanRunTargets = new Collection(fixtures.scanRunTargets);
    this.rawArtifacts = new Collection(fixtures.rawArtifacts);
    this.exceptions = new Collection(fixtures.exceptions);
    this.authorizedScopes = new Collection(fixtures.authorizedScopes);
    this.exclusionRules = new Collection(fixtures.exclusionRules);
    this.scanProfiles = new Collection(fixtures.scanProfiles);
    this.blackoutWindows = new Collection(fixtures.blackoutWindows);
    this.scanSchedules = new Collection(fixtures.scanSchedules);
    this.assetGroups = new Collection(fixtures.assetGroups);
    this.savedViews = new Collection(fixtures.savedViews);
    this.notificationChannels = new Collection(fixtures.notificationChannels);
    this.reports = new Collection(fixtures.reports);
    this.verificationScans = new Collection(fixtures.verificationScans);
    this.backupRecords = new Collection(fixtures.backupRecords);
    this.fragileDeviceRules = new Collection(fixtures.fragileDeviceRules);
    this.featureFlags = new Collection(fixtures.featureFlags.map((f) => ({ ...f, id: f.key })));
    this.retentionPolicies = new Collection(
      fixtures.retentionPolicies.map((r) => ({ ...r, id: r.dataClass })),
    );

    this.organizationSettings = fixtures.organizationSettings;
    this.pacingCeilings = fixtures.pacingCeilings;
    this.riskScoringPolicies = [fixtures.riskScoringPolicy];
    this.slaPolicies = fixtures.slaPolicies;
    this.scannerAdapters = fixtures.scannerAdapters;
    this.vulnerabilityDataImports = fixtures.vulnerabilityDataImports;
    this.notificationEvents = fixtures.notificationEvents;
    this.auditEntries = fixtures.auditEntries;
    this.globalStopEvents = fixtures.globalStopEvents;

    this.issueBreakdownById = fixtures.issueBreakdownById;
    this.riskScoreSnapshotsByIssueId = groupBy(fixtures.riskScoreSnapshots, (s) => s.issueId);
    this.issueStateHistoryByIssueId = groupBy(fixtures.issueStateHistory, (h) => h.issueId);
    this.verificationScansByIssueId = groupBy(fixtures.verificationScans, (v) => v.issueId);
    this.issuesByAssetId = groupBy(fixtures.issues, (i) => i.assetId);
    this.scanRunTargetsByRunId = groupBy(fixtures.scanRunTargets, (t) => t.scanRunId);
    this.rawArtifactsByRunId = groupBy(fixtures.rawArtifacts, (a) => a.scanRunId);

    const addressToAssetId = new Map<string, string>();
    for (const asset of fixtures.assets) {
      for (const addr of asset.addresses) addressToAssetId.set(addr.address, asset.id);
    }
    this.scanRunIdsByAssetId = new Map();
    for (const target of fixtures.scanRunTargets) {
      const assetId = addressToAssetId.get(target.targetAddress);
      if (!assetId) continue;
      const set = this.scanRunIdsByAssetId.get(assetId) ?? new Set<string>();
      set.add(target.scanRunId);
      this.scanRunIdsByAssetId.set(assetId, set);
    }
  }

  adminUserId(): string {
    return this.users.all().find((u) => u.role === 'administrator')!.id;
  }
}
