import type { components } from '@xenitex/contracts';
import type { MockServerConfig } from '../config.js';
import { makeRng } from './rng.js';
import * as catalog from './catalog.js';
import * as scale from './scale.js';
import * as misc from './misc.js';

type AuthorizedScope = components['schemas']['AuthorizedScope'];

/** PERF-01: 5,000 assets, 50,000 open issues, 250,000 retained observations. */
const SCALE_VOLUMES = {
  perf01: {
    assets: 5000,
    issues: 50_000,
    observations: 250_000,
    vulnerabilities: 3000,
    scanRuns: 200,
  },
  small: { assets: 50, issues: 400, observations: 2000, vulnerabilities: 100, scanRuns: 10 },
} as const;

export interface Fixtures {
  readonly users: components['schemas']['User'][];
  readonly organizationSettings: components['schemas']['OrganizationSettings'];
  readonly featureFlags: components['schemas']['FeatureFlag'][];
  readonly scannerAdapters: components['schemas']['ScannerAdapter'][];
  readonly vulnerabilities: components['schemas']['Vulnerability'][];
  readonly vulnerabilityDataImports: components['schemas']['VulnerabilityDataImport'][];
  readonly authorizedScopes: AuthorizedScope[];
  readonly exclusionRules: components['schemas']['ExclusionRule'][];
  readonly scanProfiles: components['schemas']['ScanProfile'][];
  readonly pacingCeilings: components['schemas']['PacingCeilings'];
  readonly fragileDeviceRules: components['schemas']['FragileDeviceRule'][];
  readonly blackoutWindows: components['schemas']['BlackoutWindow'][];
  readonly scanSchedules: components['schemas']['ScanSchedule'][];
  readonly retentionPolicies: components['schemas']['RetentionPolicy'][];
  readonly slaPolicies: components['schemas']['SlaPolicy'][];
  readonly riskScoringPolicy: components['schemas']['RiskScoringPolicy'];
  readonly assets: components['schemas']['Asset'][];
  readonly scanRuns: components['schemas']['ScanRun'][];
  readonly scanRunTargets: components['schemas']['ScanRunTarget'][];
  readonly rawArtifacts: components['schemas']['RawArtifact'][];
  readonly observations: components['schemas']['Observation'][];
  readonly issues: components['schemas']['Issue'][];
  readonly issueBreakdownById: Map<string, components['schemas']['ScoreFactorContribution'][]>;
  readonly riskScoreSnapshots: components['schemas']['RiskScoreSnapshot'][];
  readonly issueStateHistory: components['schemas']['IssueStateHistoryEntry'][];
  readonly exceptions: components['schemas']['Exception'][];
  readonly verificationScans: components['schemas']['VerificationScan'][];
  readonly reports: components['schemas']['Report'][];
  readonly notificationChannels: components['schemas']['NotificationChannel'][];
  readonly notificationEvents: components['schemas']['NotificationEvent'][];
  readonly auditEntries: components['schemas']['AuditEntry'][];
  readonly backupRecords: components['schemas']['BackupRecord'][];
  readonly assetGroups: components['schemas']['AssetGroup'][];
  readonly savedViews: components['schemas']['SavedView'][];
  readonly globalStopEvents: components['schemas']['GlobalStopEvent'][];
}

export function generateFixtures(config: MockServerConfig): Fixtures {
  const volumes = SCALE_VOLUMES[config.fixtureScale];
  const rng = makeRng(config.seed);

  const users = catalog.generateUsers();
  const adminUserId = users.find((u) => u.role === 'administrator')!.id;
  const userIds = users.map((u) => u.id);

  const organizationSettings = catalog.generateOrganizationSettings();
  const featureFlags = catalog.generateFeatureFlags();
  const scannerAdapters = catalog.generateScannerAdapters();
  const { vulnerabilities, imports: vulnerabilityDataImports } = catalog.generateVulnerabilities(
    rng,
    volumes.vulnerabilities,
  );
  const authorizedScopes = catalog.generateAuthorizedScopes(rng, adminUserId);
  const exclusionRules = catalog.generateExclusionRules(rng, authorizedScopes, adminUserId);
  const scanProfiles = catalog.generateScanProfiles(adminUserId);
  const pacingCeilings = catalog.generatePacingCeilings();
  const fragileDeviceRules = catalog.generateFragileDeviceRules();
  const blackoutWindows = catalog.generateBlackoutWindows(rng, authorizedScopes, adminUserId);
  const scanSchedules = catalog.generateScanSchedules(authorizedScopes, scanProfiles, adminUserId);
  const retentionPolicies = catalog.generateRetentionPolicies();
  const slaPolicies = catalog.generateSlaPolicies();
  const riskScoringPolicy = catalog.generateRiskScoringPolicy(adminUserId);

  const assetsWithServices = scale.generateAssets(rng, volumes.assets);
  const assets = assetsWithServices.map((a) => a.asset);

  const assetsByScope: (typeof assetsWithServices)[] = authorizedScopes.map((_, i) =>
    assetsWithServices.filter((_a, idx) => idx % authorizedScopes.length === i),
  );

  const { scanRuns, scanRunTargets, rawArtifacts } = scale.generateScanRuns(
    rng,
    volumes.scanRuns,
    authorizedScopes,
    scanProfiles,
    scannerAdapters,
    assetsByScope,
    userIds,
  );

  const { observations, observationIdsByAssetId } = scale.generateObservations(
    rng,
    volumes.observations,
    assetsWithServices,
    scanRuns,
    rawArtifacts,
    scannerAdapters,
  );

  const { issues, riskScoreSnapshots, issueStateHistory, issueBreakdownById } =
    scale.generateIssues(
      rng,
      volumes.issues,
      assetsWithServices,
      vulnerabilities,
      observationIdsByAssetId,
      userIds,
      riskScoringPolicy.weights,
      riskScoringPolicy.version,
    );
  scale.applyAssetRiskRatings(assets, issues, vulnerabilities);

  const { exceptions, issuePatches } = scale.generateExceptions(rng, issues, userIds);
  for (const issue of issues) {
    const exceptionId = issuePatches.get(issue.id);
    if (exceptionId) (issue as { exceptionId: string | null }).exceptionId = exceptionId;
  }

  const verificationScans = scale.generateVerificationScans(rng, issues, scanRuns);
  const reports = misc.generateReports(rng, userIds);
  const { channels: notificationChannels, events: notificationEvents } =
    misc.generateNotifications(rng);
  const auditEntries = misc.generateAuditEntries(rng, userIds);
  const backupRecords = misc.generateBackupRecords(rng);
  const assetGroups = misc.generateAssetGroups(rng, assets);
  const savedViews = misc.generateSavedViews(adminUserId);
  const globalStopEvents = misc.generateGlobalStopHistory(adminUserId);

  return {
    users,
    organizationSettings,
    featureFlags,
    scannerAdapters,
    vulnerabilities,
    vulnerabilityDataImports,
    authorizedScopes,
    exclusionRules,
    scanProfiles,
    pacingCeilings,
    fragileDeviceRules,
    blackoutWindows,
    scanSchedules,
    retentionPolicies,
    slaPolicies,
    riskScoringPolicy,
    assets,
    scanRuns,
    scanRunTargets,
    rawArtifacts,
    observations,
    issues,
    issueBreakdownById,
    riskScoreSnapshots,
    issueStateHistory,
    exceptions,
    verificationScans,
    reports,
    notificationChannels,
    notificationEvents,
    auditEntries,
    backupRecords,
    assetGroups,
    savedViews,
    globalStopEvents,
  };
}
