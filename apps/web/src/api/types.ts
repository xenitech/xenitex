import type { components } from '@xenitex/contracts';

/**
 * Ergonomic aliases onto the generated wire types (P1-02) — these are the
 * shapes that actually cross the network (camelCase, `Untrusted`-suffixed
 * fields, nullable unions), distinct from `@xenitex/domain`'s branded
 * backend-internal types. Screens import from here, not from the generated
 * module directly, so a schema rename is a one-file fix.
 */
export type Schemas = components['schemas'];

export type CurrentUser = Schemas['CurrentUser'];
export type User = Schemas['User'];
export type UserRole = Schemas['UserRole'];
export type IssueState = Schemas['IssueState'];
export type ConfidenceLabel = Schemas['ConfidenceLabel'];
export type FalsePositiveReasonCode = Schemas['FalsePositiveReasonCode'];
export type AssetCriticality = Schemas['AssetCriticality'];
export type ExposureClassification = Schemas['ExposureClassification'];
export type AssetLifecycleState = Schemas['AssetLifecycleState'];
export type IdentityKeyType = Schemas['IdentityKeyType'];
export type AttestationType = Schemas['AttestationType'];
export type ExclusionRuleType = Schemas['ExclusionRuleType'];
export type IntrusivenessProfile = Schemas['IntrusivenessProfile'];
export type ReportTemplate = Schemas['ReportTemplate'];
export type ReportStatus = Schemas['ReportStatus'];
export type NotificationChannelType = Schemas['NotificationChannelType'];
export type RetentionDataClass = Schemas['RetentionDataClass'];
export type Asset = Schemas['Asset'];
export type Issue = Schemas['Issue'];
export type IssueDetail = Schemas['IssueDetail'];
export type Observation = Schemas['Observation'];
export type Vulnerability = Schemas['Vulnerability'];
export type ScoreFactorContribution = Schemas['ScoreFactorContribution'];
export type AuthorizedScope = Schemas['AuthorizedScope'];
export type ExclusionRule = Schemas['ExclusionRule'];
export type ScanProfile = Schemas['ScanProfile'];
export type BlackoutWindow = Schemas['BlackoutWindow'];
export type ScanSchedule = Schemas['ScanSchedule'];
export type ScanPlanPreview = Schemas['ScanPlanPreview'];
export type ScanRun = Schemas['ScanRun'];
export type ScanRunTarget = Schemas['ScanRunTarget'];
export type Exception = Schemas['Exception'];
export type Report = Schemas['Report'];
export type NotificationChannel = Schemas['NotificationChannel'];
export type AuditEntry = Schemas['AuditEntry'];
export type AuditChainVerificationResult = Schemas['AuditChainVerificationResult'];
export type RetentionPolicy = Schemas['RetentionPolicy'];
export type BackupRecord = Schemas['BackupRecord'];
export type SystemHealth = Schemas['SystemHealth'];
export type DashboardSummary = Schemas['DashboardSummary'];
export type SavedView = Schemas['SavedView'];
export type FeatureFlag = Schemas['FeatureFlag'];
export type ProblemDetails = Schemas['ProblemDetails'];
export type SetupStatus = Schemas['SetupStatus'];
export type MfaChallengeRequired = Schemas['MfaChallengeRequired'];
