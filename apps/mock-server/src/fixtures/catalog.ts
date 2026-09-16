import type { components } from '@xenitex/contracts';
import { DEFAULT_RISK_SCORING_WEIGHTS } from '@xenitex/domain';
import type { Rng } from './rng.js';
import { CWE_IDS, VENDOR_PRODUCTS, VULN_KIND_PHRASES } from './data-pools.js';

type User = components['schemas']['User'];
type Vulnerability = components['schemas']['Vulnerability'];
type VulnerabilityDataImport = components['schemas']['VulnerabilityDataImport'];
type ScannerAdapter = components['schemas']['ScannerAdapter'];
type OrganizationSettings = components['schemas']['OrganizationSettings'];
type FeatureFlag = components['schemas']['FeatureFlag'];
type AuthorizedScope = components['schemas']['AuthorizedScope'];
type ExclusionRule = components['schemas']['ExclusionRule'];
type ScanProfile = components['schemas']['ScanProfile'];
type PacingCeilings = components['schemas']['PacingCeilings'];
type FragileDeviceRule = components['schemas']['FragileDeviceRule'];
type BlackoutWindow = components['schemas']['BlackoutWindow'];
type ScanSchedule = components['schemas']['ScanSchedule'];
type RetentionPolicy = components['schemas']['RetentionPolicy'];
type SlaPolicy = components['schemas']['SlaPolicy'];
type RiskScoringPolicy = components['schemas']['RiskScoringPolicy'];

const NOW = new Date();
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 86_400_000).toISOString();

/** Fixed four fixed-role users (anti-goal: no custom RBAC) — one of each, plus a couple extra analysts/viewers. */
export function generateUsers(): User[] {
  return [
    {
      id: 'user-admin-1',
      email: 'admin@pilot-customer.example',
      displayName: 'Ada Administrator',
      role: 'administrator',
      mfaEnabled: true,
      isActive: true,
      createdAt: daysAgo(120),
      mustChangePassword: false,
    },
    {
      id: 'user-operator-1',
      email: 'operator@pilot-customer.example',
      displayName: 'Omar Operator',
      role: 'operator',
      mfaEnabled: true,
      isActive: true,
      createdAt: daysAgo(110),
      mustChangePassword: false,
    },
    {
      id: 'user-analyst-1',
      email: 'analyst1@pilot-customer.example',
      displayName: 'Priya Analyst',
      role: 'analyst',
      mfaEnabled: false,
      isActive: true,
      createdAt: daysAgo(90),
      mustChangePassword: false,
    },
    // Seeded with mustChangePassword: true so the forced-password-change screen (P1-07) has a real,
    // reachable-by-login path to exercise in Step 3, not just a Storybook-only state.
    {
      id: 'user-analyst-2',
      email: 'analyst2@pilot-customer.example',
      displayName: 'Leo Analyst',
      role: 'analyst',
      mfaEnabled: false,
      isActive: true,
      createdAt: daysAgo(60),
      mustChangePassword: true,
    },
    {
      id: 'user-viewer-1',
      email: 'viewer@pilot-customer.example',
      displayName: 'Vera Viewer',
      role: 'viewer',
      mfaEnabled: false,
      isActive: true,
      createdAt: daysAgo(30),
      mustChangePassword: false,
    },
  ];
}

export function generateOrganizationSettings(): OrganizationSettings {
  return {
    organizationName: 'Pilot Customer, Inc.',
    timezone: 'America/New_York',
    tlsMode: 'self_signed',
    setupCompletedAt: daysAgo(120),
  };
}

/** EXT-07: `remediation_executor_enabled` is hard-off by construction, not merely by default (EXT-09). */
export function generateFeatureFlags(): FeatureFlag[] {
  return [
    {
      key: 'remediation_executor_enabled',
      description: 'Rung 3 execution capability — no implementation exists',
      isEnabled: false,
      updatedAt: daysAgo(120),
    },
    {
      key: 'digest_notifications',
      description: 'Send digest (rather than immediate) notifications where a channel supports it',
      isEnabled: true,
      updatedAt: daysAgo(80),
    },
  ];
}

/** P2-04: two adapters only — network discovery, and template-based checks over HTTP/network services. */
export function generateScannerAdapters(): ScannerAdapter[] {
  return [
    {
      adapterKey: 'network-discovery',
      version: '1.4.0',
      fidelityRating: 0.9,
      isEnabled: true,
      capabilities: { serviceDetection: true, versionDetection: true },
    },
    {
      adapterKey: 'template-checks',
      version: '2.1.3',
      fidelityRating: 0.75,
      isEnabled: true,
      capabilities: { protocols: ['http', 'https', 'tcp-banner'] },
    },
  ];
}

export function generateVulnerabilities(
  rng: Rng,
  count: number,
): { vulnerabilities: Vulnerability[]; imports: VulnerabilityDataImport[] } {
  const imports: VulnerabilityDataImport[] = [
    {
      id: 'import-nvd-1',
      sourceName: 'nvd-cve',
      sourceVersion: '2024.11',
      status: 'applied',
      importedAt: daysAgo(3),
      supersededById: null,
    },
    {
      id: 'import-kev-1',
      sourceName: 'cisa-kev',
      sourceVersion: '2024.11.20',
      status: 'applied',
      importedAt: daysAgo(3),
      supersededById: null,
    },
    {
      id: 'import-epss-1',
      sourceName: 'epss',
      sourceVersion: '2024.11.20',
      status: 'applied',
      importedAt: daysAgo(3),
      supersededById: null,
    },
  ];

  const vulnerabilities: Vulnerability[] = [];
  for (let i = 0; i < count; i++) {
    const year = rng.int(2015, 2024);
    const seq = rng.int(1000, 49999);
    const cve = `CVE-${year}-${seq}`;
    const knownExploited = rng.boolean(0.06);
    const cvssBaseScore = Number((rng.float() * 10).toFixed(1));
    // EPSS-style: knownExploited implies a high floor, matching MOD-16's "known-exploited outweighs CVSS" premise.
    const exploitProbability = Number(
      (knownExploited ? 0.6 + rng.float() * 0.4 : rng.float() * 0.5).toFixed(4),
    );
    const product = rng.pick(VENDOR_PRODUCTS);
    const kindPhrase = rng.pick(VULN_KIND_PHRASES);
    vulnerabilities.push({
      id: `vuln-${i}`,
      title: `${product} ${kindPhrase}`,
      vulnIdentifier: cve,
      cveIds: [cve],
      cweIds: [rng.pick(CWE_IDS)],
      affectedCpes: [
        {
          cpe: `cpe:2.3:a:*:${product.toLowerCase().replaceAll(' ', '_')}:*:*:*:*:*:*:*:*`,
          versionRange: '<' + rng.int(1, 9) + '.' + rng.int(0, 9) + '.0',
        },
      ],
      cvssVector: `CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H`,
      cvssVersion: '3.1',
      cvssBaseScore,
      exploitProbability,
      knownExploited,
      knownExploitedSource: knownExploited ? 'cisa-kev' : null,
      publishedAt: daysAgo(rng.int(30, 2000)),
      modifiedAt: daysAgo(rng.int(1, 30)),
      description: `${product} versions prior to the fixed release are affected by a vulnerability allowing an unauthenticated remote attacker to compromise confidentiality or integrity.`,
      canonicalRemediation: `Upgrade ${product} to the vendor-fixed version.`,
      dataImportId: imports[0]!.id,
    });
  }
  return { vulnerabilities, imports };
}

export function generateAuthorizedScopes(rng: Rng, adminUserId: string): AuthorizedScope[] {
  const names = [
    'Corporate LAN',
    'DMZ',
    'Cloud VPC — prod',
    'Branch offices',
    'OT / facilities network',
  ];
  return names.map((name, i) => ({
    id: `scope-${i}`,
    name,
    cidrRanges: [`10.${i * 10}.0.0/16`],
    hostnames: [],
    attestationType: rng.pick([
      'self_attested_owner',
      'delegated_authority',
      'contract_engagement',
    ] as const),
    attestationDetails: `Declared by ${name} owning team during onboarding.`,
    acceptedByUserId: adminUserId,
    acceptedAt: daysAgo(120 - i * 5),
    supersededById: null,
  }));
}

export function generateExclusionRules(
  rng: Rng,
  scopes: AuthorizedScope[],
  adminUserId: string,
): ExclusionRule[] {
  const rules: ExclusionRule[] = [];
  for (const scope of scopes) {
    const [firstOctet, secondOctet] = scope.cidrRanges![0]!.split('.');
    rules.push({
      id: `excl-${scope.id}-1`,
      scopeId: scope.id,
      ruleType: 'address',
      value: `${firstOctet}.${secondOctet}.0.1`,
      reason: 'Gateway address — historically unstable under active probing.',
      createdBy: adminUserId,
      isActive: true,
    });
  }
  rules.push({
    id: 'excl-global-tag',
    scopeId: null,
    ruleType: 'tag',
    value: 'do-not-scan',
    reason: 'Global exclusion for anything tagged do-not-scan regardless of scope.',
    createdBy: adminUserId,
    isActive: true,
  });
  return rules;
}

export function generateScanProfiles(adminUserId: string): ScanProfile[] {
  const base: Array<Omit<ScanProfile, 'createdBy'>> = [
    {
      id: 'profile-passive',
      name: 'Passive inventory',
      intrusiveness: 'passive-inventory',
      pacing: {
        packetsPerSecond: 50,
        concurrentHosts: 20,
        concurrentPortsPerHost: 5,
        timeoutMs: 2000,
        retries: 1,
      },
      requiresConfirmation: false,
    },
    {
      id: 'profile-safe',
      name: 'Safe (default)',
      intrusiveness: 'safe',
      pacing: {
        packetsPerSecond: 200,
        concurrentHosts: 50,
        concurrentPortsPerHost: 20,
        timeoutMs: 3000,
        retries: 2,
      },
      requiresConfirmation: false,
    },
    {
      id: 'profile-standard',
      name: 'Standard',
      intrusiveness: 'standard',
      pacing: {
        packetsPerSecond: 500,
        concurrentHosts: 100,
        concurrentPortsPerHost: 50,
        timeoutMs: 4000,
        retries: 2,
      },
      requiresConfirmation: true,
    },
  ];
  return base.map((p) => ({ ...p, createdBy: adminUserId }));
}

export function generatePacingCeilings(): PacingCeilings {
  return {
    maxPacketsPerSecond: 1000,
    maxConcurrentHosts: 200,
    maxConcurrentPortsPerHost: 100,
    maxTimeoutMs: 10_000,
    maxRetries: 5,
  };
}

export function generateFragileDeviceRules(): FragileDeviceRule[] {
  const classes = [
    'printer',
    'plc',
    'medical_device',
    'legacy_network_gear',
    'building_management_controller',
  ];
  return classes.map((deviceClass, i) => ({
    id: `fragile-${i}`,
    deviceClass,
    matchCriteria: { ouiPrefixes: [], bannerPatterns: [deviceClass] },
    isEnabled: true,
  }));
}

export function generateBlackoutWindows(
  rng: Rng,
  scopes: AuthorizedScope[],
  adminUserId: string,
): BlackoutWindow[] {
  return [
    {
      id: 'blackout-global-maintenance',
      scopeId: null,
      name: 'Weekly maintenance window',
      timezone: 'America/New_York',
      startsAt: daysAgo(-1),
      endsAt: daysAgo(-1),
      isRecurring: true,
      rrule: 'FREQ=WEEKLY;BYDAY=SU;BYHOUR=2',
    },
    {
      id: 'blackout-ot-network',
      scopeId: scopes.find((s) => s.name.includes('OT'))?.id ?? null,
      name: 'OT change freeze',
      timezone: 'America/New_York',
      startsAt: daysAgo(-10),
      endsAt: daysAgo(-3),
      isRecurring: false,
      rrule: null,
    },
  ].map((w) => ({ ...w, createdBy: adminUserId }));
}

export function generateScanSchedules(
  scopes: AuthorizedScope[],
  profiles: ScanProfile[],
  adminUserId: string,
): ScanSchedule[] {
  const safeProfile = profiles.find((p) => p.intrusiveness === 'safe')!;
  return scopes.map((scope, i) => ({
    id: `schedule-${i}`,
    name: `Weekly ${scope.name} scan`,
    scopeId: scope.id,
    profileId: safeProfile.id,
    cronExpression: '0 2 * * 0',
    timezone: 'America/New_York',
    isEnabled: true,
    createdBy: adminUserId,
    nextRunAt: new Date(NOW.getTime() + 3 * 86_400_000).toISOString(),
  }));
}

/** DATA-04: GATE 1-accepted 365-day audit floor (docs/database-schema.md §16). */
export function generateRetentionPolicies(): RetentionPolicy[] {
  return [
    { dataClass: 'audit_log', retentionDays: 365, minimumFloorDays: 365 },
    { dataClass: 'raw_artifacts', retentionDays: 180, minimumFloorDays: 30 },
    { dataClass: 'observations', retentionDays: 365, minimumFloorDays: 30 },
    { dataClass: 'resolved_issues', retentionDays: 730, minimumFloorDays: 90 },
  ];
}

/** MOD-14: policy matrix over risk band x asset criticality. */
export function generateSlaPolicies(): SlaPolicy[] {
  const riskBands = ['low', 'medium', 'high', 'critical'] as const;
  const criticalities = ['low', 'medium', 'high', 'critical'] as const;
  const dueWithinDaysMatrix: Record<string, number> = {
    'critical-critical': 3,
    'critical-high': 7,
    'critical-medium': 14,
    'critical-low': 30,
    'high-critical': 7,
    'high-high': 14,
    'high-medium': 30,
    'high-low': 45,
    'medium-critical': 30,
    'medium-high': 45,
    'medium-medium': 60,
    'medium-low': 90,
    'low-critical': 60,
    'low-high': 90,
    'low-medium': 120,
    'low-low': 180,
  };
  let id = 0;
  const rows: SlaPolicy[] = [];
  for (const riskBand of riskBands) {
    for (const assetCriticality of criticalities) {
      rows.push({
        id: `sla-${id++}`,
        riskBand,
        assetCriticality,
        dueWithinDays: dueWithinDaysMatrix[`${riskBand}-${assetCriticality}`]!,
        version: 1,
        isActive: true,
      });
    }
  }
  return rows;
}

/** MOD-15/MOD-18: docs/issues-scoring-dashboard-spec.md SCORE 2.2 default weights — version 2, superseding ADR-0004's weighted sum (see that ADR's "Update"). */
export function generateRiskScoringPolicy(adminUserId: string): RiskScoringPolicy {
  return {
    version: 2,
    weights: DEFAULT_RISK_SCORING_WEIGHTS,
    isActive: true,
    createdBy: adminUserId,
    createdAt: daysAgo(120),
  };
}
