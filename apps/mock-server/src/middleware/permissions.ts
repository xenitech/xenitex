/**
 * P1-23: this is a mock approximation of the server-side capability model so
 * Step 3 can build permission-denied UI states against *something* real.
 * SEC-13 remains the governing rule: this is cosmetic for the mock, and
 * Step 4's real API is the actual enforcement — this table is not that
 * enforcement and must not be copied there unreviewed.
 */
export type Role = 'viewer' | 'analyst' | 'operator' | 'administrator';

const ROLE_RANK: Record<Role, number> = { viewer: 0, analyst: 1, operator: 2, administrator: 3 };

const TAG_READ_ROLE: Record<string, Role> = {
  Users: 'operator',
  Audit: 'operator',
};

const TAG_WRITE_ROLE: Record<string, Role> = {
  Users: 'administrator',
  OrganizationSettings: 'administrator',
  FeatureFlags: 'administrator',
  Assets: 'analyst',
  AssetGroups: 'analyst',
  Issues: 'analyst',
  SavedViews: 'analyst',
  Exceptions: 'analyst',
  RiskScoring: 'administrator',
  SlaPolicies: 'administrator',
  Scopes: 'operator',
  ExclusionRules: 'operator',
  ScanProfiles: 'operator',
  PacingCeilings: 'administrator',
  FragileDeviceRules: 'administrator',
  BlackoutWindows: 'operator',
  ScanSchedules: 'operator',
  Scans: 'operator',
  VerificationScans: 'operator',
  GlobalStop: 'operator',
  Reports: 'analyst',
  Notifications: 'operator',
  Retention: 'administrator',
  Backup: 'administrator',
};

/** Overrides that don't fit the tag-level default — e.g. approving an exception is a higher bar than requesting one. */
const OPERATION_OVERRIDES: Record<string, Role> = {
  approveException: 'operator',
  createAssetMerge: 'operator',
  reverseAssetMerge: 'operator',
  createUser: 'administrator',
  updateUser: 'administrator',
  deactivateUser: 'administrator',
};

export function requiredRole(operationId: string, tags: readonly string[], method: string): Role {
  const override = OPERATION_OVERRIDES[operationId];
  if (override) return override;

  const tag = tags[0] ?? '';
  const isRead = method === 'GET' || method === 'HEAD';
  if (isRead) return TAG_READ_ROLE[tag] ?? 'viewer';
  return TAG_WRITE_ROLE[tag] ?? 'analyst';
}

export function hasRole(actual: Role, required: Role): boolean {
  return ROLE_RANK[actual] >= ROLE_RANK[required];
}

export function isValidRole(value: string): value is Role {
  return (
    value === 'viewer' || value === 'analyst' || value === 'operator' || value === 'administrator'
  );
}
