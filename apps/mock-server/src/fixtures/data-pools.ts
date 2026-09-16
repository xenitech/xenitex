/**
 * Small pools of realistic-looking strings for fixture generation. None of
 * this is sourced from real scanner output — it exists purely so Step 3
 * screens have plausible-looking text to render, not to imply any of it is
 * evidence (MOD-21's evidence requirement is about the real pipeline, not
 * this mock).
 */
export const VENDOR_PRODUCTS = [
  'nginx',
  'Apache httpd',
  'OpenSSH',
  'Microsoft IIS',
  'vsftpd',
  'ProFTPD',
  'Postfix',
  'Dovecot',
  'MySQL',
  'PostgreSQL',
  'Redis',
  'MongoDB',
  'Jenkins',
  'GitLab',
  'Grafana',
  'Elasticsearch',
  'Tomcat',
  'WordPress',
  'Cisco IOS',
  'Juniper JunOS',
  'F5 BIG-IP',
  'Fortinet FortiOS',
] as const;

export const OS_LABELS = [
  'Ubuntu 22.04',
  'Ubuntu 20.04',
  'Debian 12',
  'Red Hat Enterprise Linux 9',
  'Windows Server 2022',
  'Windows Server 2019',
  'Windows 10 Enterprise',
  'CentOS Linux 7 (EOL)',
  'Cisco IOS XE',
  'FreeBSD 14',
  'VMware ESXi 8.0',
] as const;

export const HOSTNAME_PREFIXES = [
  'web',
  'app',
  'db',
  'api',
  'mail',
  'dc',
  'vpn',
  'proxy',
  'cache',
  'lb',
  'jump',
  'monitor',
  'build',
  'printer',
  'plc',
  'nvr',
  'switch',
  'router',
] as const;

export const DOMAIN_SUFFIXES = ['corp.internal', 'prod.internal', 'lab.internal'] as const;

export const OWNER_TEAMS = [
  'Platform',
  'Payments',
  'Networking',
  'Identity',
  'Data',
  'Retail Systems',
  'Facilities OT',
  'Corporate IT',
  null,
] as const;

export const TAGS = [
  'pci-scope',
  'internet-facing',
  'legacy',
  'decommission-pending',
  'crown-jewel',
  'dev',
  'staging',
  'prod',
  'unmanaged',
  'vendor-managed',
  'ot',
] as const;

export const CWE_IDS = [
  'CWE-79',
  'CWE-89',
  'CWE-287',
  'CWE-352',
  'CWE-434',
  'CWE-798',
  'CWE-918',
  'CWE-1104',
] as const;

/** Short, human-scannable vulnerability-kind phrases — combined with a product name for Vulnerability.title (the Issues list row's title, per docs/design/wireframe-issues.md). */
export const VULN_KIND_PHRASES = [
  'remote code execution',
  'authentication bypass',
  'privilege escalation',
  'information disclosure',
  'denial of service',
  'path traversal',
  'SQL injection',
  'deserialization vulnerability',
  'server-side request forgery',
] as const;

export const CONFIG_ISSUE_TYPES = [
  { key: 'config.tls.weak-cipher-suite', label: 'Weak TLS cipher suite offered' },
  { key: 'config.tls.expired-certificate', label: 'TLS certificate expired' },
  { key: 'config.http.missing-security-headers', label: 'Missing security response headers' },
  {
    key: 'config.exposure.unauthenticated-admin-panel',
    label: 'Unauthenticated administrative interface reachable',
  },
  { key: 'config.service.default-credentials-suspected', label: 'Default credentials suspected' },
  {
    key: 'config.exposure.database-port-internet-reachable',
    label: 'Database port reachable from outside the declared scope boundary',
  },
] as const;

export const FALSE_POSITIVE_REASONS = [
  'not_applicable_environment',
  'patched_not_reflected',
  'false_signature_match',
  'compensating_control',
  'duplicate_of_other_issue',
  'other',
] as const;

export const REMEDIATION_STEPS_BY_TYPE: Record<string, string> = {
  'config.tls.weak-cipher-suite':
    'Disable TLS 1.0/1.1 and RC4/3DES cipher suites; restrict to TLS 1.2+ with AEAD ciphers.',
  'config.tls.expired-certificate':
    'Reissue and install a valid certificate; enable expiry monitoring going forward.',
  'config.http.missing-security-headers':
    'Add Content-Security-Policy, X-Content-Type-Options, and Strict-Transport-Security response headers.',
  'config.exposure.unauthenticated-admin-panel':
    'Restrict the admin interface to the management network and require authentication.',
  'config.service.default-credentials-suspected':
    'Rotate credentials immediately and confirm the account is not internet-reachable.',
  'config.exposure.database-port-internet-reachable':
    'Move the database behind the firewall boundary; restrict access to application-tier hosts only.',
  default:
    'Apply the vendor-provided patch or configuration change for the affected version; verify with a verification scan.',
};
