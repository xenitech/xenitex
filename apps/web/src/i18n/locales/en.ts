/**
 * English resource bundle. Source language — every key here must have a
 * Persian counterpart in `fa.ts` (checked by `i18n/completeness.test.ts`).
 * Flat-ish nesting by screen area (P1-20): nav/auth/setup/issues/assets/
 * scans/scope/exceptions/dashboard/reports/admin/components/common.
 */
export const en = {
  common: {
    loading: 'Loading…',
    retry: 'Retry',
    cancel: 'Cancel',
    save: 'Save',
    confirm: 'Confirm',
    close: 'Close',
    back: 'Back',
    next: 'Next',
    yes: 'Yes',
    no: 'No',
    search: 'Search',
    filters: 'Filters',
    export: 'Export view',
    density: 'Density',
    densityCompact: 'Compact',
    densityComfortable: 'Comfortable',
    theme: 'Theme',
    themeLight: 'Light',
    themeDark: 'Dark',
    language: 'Language',
    globalStop: 'Global stop',
    unknown: 'Unknown',
    current: 'current',
    roles: {
      viewer: 'viewer',
      analyst: 'analyst',
      operator: 'operator',
      administrator: 'administrator',
    },
    criticality: {
      low: 'Low',
      medium: 'Medium',
      high: 'High',
      critical: 'Critical',
    },
    exposure: {
      internal: 'Internal',
      dmz: 'DMZ',
      external: 'External',
      unknown: 'Unknown',
    },
  },
  components: {
    riskBadge: {
      critical: 'Critical',
      high: 'High',
      medium: 'Medium',
      low: 'Low',
      info: 'Info',
      explain: 'Risk score {{score}}, {{band}} — show explanation',
    },
    confidence: {
      inferred: 'Inferred',
      corroborated: 'Corroborated',
      verified: 'Verified',
    },
    state: {
      new: 'New',
      triaged: 'Triaged',
      in_progress: 'In progress',
      mitigated: 'Mitigated',
      verified_resolved: 'Verified resolved',
      reopened: 'Reopened',
      false_positive: 'False positive',
      risk_accepted: 'Risk accepted',
    },
    riskExplainer: {
      factorCvssBaseScore: 'CVSS base',
      factorExploitProbability: 'Exploit probability',
      factorKnownExploited: 'Known-exploited (CISA KEV)',
      factorExposureClassification: 'Exposure',
      factorAssetCriticality: 'Asset criticality',
      factorConfidence: 'Confidence',
      version: 'Scoring function v{{version}}',
      unavailableNoBreakdown:
        'No scoring breakdown was stored for this issue, so its score cannot be explained here. Re-scoring the issue will produce one.',
      unavailableLegacyFormat:
        'This score was produced by an earlier version of the scoring function and cannot be explained in the current format. Re-scoring the issue will produce a current breakdown.',
      partialBreakdown:
        'Showing {{shown}} of {{total}} stored factors — the rest were written in a format this view cannot read, so these rows do not add up to the total score.',
    },
    emptyState: {
      noScope: {
        title: 'No scope has been authorised yet',
        description: 'Issues appear here once a scan has run against an authorised scope.',
        action: 'Declare a scope',
      },
    },
    errorState: {
      unavailableTitle: 'This area is not available right now',
      unavailableDetail:
        'Something on this screen could not be displayed. The rest of the appliance is unaffected — scanning, findings, and the audit log are all still running normally.',
      title: 'Something went wrong',
      code: 'code: {{code}}',
      correlation: 'correlation: {{id}}',
    },
    permissionDenied: {
      title: "You don't have access to this",
      detail: 'This action requires the {{role}} role or higher. Ask an {{grantedBy}} to grant it.',
    },
  },
  nav: {
    dashboard: 'Dashboard',
    issues: 'Issues',
    assets: 'Assets',
    scans: 'Scans',
    scope: 'Scope & exclusions',
    exceptions: 'Exceptions',
    reports: 'Reports',
    admin: 'Administration',
    signOut: 'Sign out',
    skipToContent: 'Skip to content',
  },
  auth: {
    signIn: {
      title: 'Sign in',
      email: 'Email',
      password: 'Password',
      submit: 'Sign in',
      invalid: 'Incorrect email or password.',
      lockedOut: 'Too many failed attempts. Try again later.',
      rateLimited: 'Too many requests. Wait a moment and try again.',
    },
    mfa: {
      title: 'Two-factor verification',
      description: 'Enter the 6-digit code from your authenticator app.',
      code: 'Authenticator code',
      useRecovery: 'Use a recovery code instead',
      recoveryCode: 'Recovery code',
      submit: 'Verify',
      invalid: 'Incorrect code.',
    },
    enroll: {
      title: 'Set up two-factor authentication',
      description:
        'An authenticator (TOTP) app is required for your role. Scan the QR code or enter the secret manually, then confirm with a code.',
      secretLabel: 'Manual entry secret',
      code: 'Confirm with a code',
      submit: 'Enable two-factor authentication',
      recoveryTitle: 'Save your recovery codes',
      recoveryDescription:
        'These codes are shown once. Store them somewhere safe — each can be used once if you lose access to your authenticator.',
      recoveryAcknowledge: "I've saved these codes",
    },
    forcedPasswordChange: {
      title: 'Choose a new password',
      description: 'Your password must be changed before continuing.',
      current: 'Current password',
      next: 'New password',
      confirm: 'Confirm new password',
      submit: 'Change password',
      mismatch: 'Passwords do not match.',
    },
  },
  setup: {
    title: 'Set up Xenitex',
    steps: {
      administrator: 'Administrator account',
      organization: 'Organisation',
      tls: 'TLS',
      scope: 'Authorised scope',
      safety: 'Safety review',
    },
    administrator: {
      description: 'Create the first administrator account for this appliance.',
      displayName: 'Full name',
      email: 'Email',
      password: 'Password',
      passwordHint: 'At least 12 characters. Checked against a breached-password list.',
    },
    organization: {
      description:
        'Name your organisation and set its timezone (DATA-06). All timestamps are stored in UTC and displayed in this timezone.',
      name: 'Organisation name',
      timezone: 'Timezone',
    },
    tls: {
      description: 'Choose how the appliance presents TLS to browsers on your network (SEC-06).',
      selfSigned: 'Self-signed certificate (default)',
      selfSignedHint:
        'Generated automatically at first run. Browsers will warn until you install the certificate or your own.',
      customerCertificate: 'Install our own certificate',
      customerCertificateHint:
        'Recommended for production. You will upload the certificate after setup completes.',
    },
    scope: {
      description:
        'Declare the first network range or set of hostnames this appliance is authorised to scan (SAFE-01). This cannot be skipped — the appliance can act on nothing until a scope exists.',
      name: 'Scope name',
      cidrRanges: 'CIDR ranges (one per line)',
      hostnames: 'Hostnames (one per line)',
      attestationType: 'Authority for this scope',
      attestationTypes: {
        self_attested_owner: 'I own or administer these systems',
        delegated_authority: 'Delegated authority from the owner',
        contract_engagement: 'Contracted engagement',
        other: 'Other',
      },
      attestationDetails: 'Details of your authority to scan this scope',
    },
    safety: {
      description:
        'Review the safety defaults this appliance enforces before it can run its first scan.',
      items: [
        'New scans default to the passive-inventory or safe intrusiveness profile — never standard without typed confirmation.',
        'Server-side pacing ceilings apply regardless of what a client requests.',
        'Devices matching a fragile-device heuristic are automatically downgraded to passive-inventory and never auto-upgraded.',
        'A global stop control halts all scan activity immediately and is reachable from every screen.',
        'Every scan requires a pre-flight plan confirmation showing target count, estimated duration, exclusions, and fragile downgrades before it can start.',
      ],
      acknowledge: 'I have reviewed these safety defaults',
    },
    complete: {
      title: 'Setup complete',
      description:
        'Xenitex is ready. You can adjust any of these settings later from Administration.',
      enterApp: 'Continue to the appliance',
    },
  },
  issues: {
    title: 'Issues',
    noCve: 'No CVE — configuration or exposure issue',
    savedViews: 'Saved views',
    saveView: 'Save current view',
    keyboardHint: 'j/k to move, Enter to open',
    columns: {
      risk: 'Risk',
      issue: 'Issue',
      asset: 'Asset',
      service: 'Svc/port',
      confidence: 'Confidence',
      state: 'State',
      age: 'Age',
      sla: 'SLA',
      owner: 'Owner',
    },
    confidenceFloor: 'Confidence floor',
    filters: {
      state: 'State',
      overdue: 'Overdue only',
      minRiskScore: 'Minimum risk score',
    },
    detail: {
      tabs: { overview: 'Overview', evidence: 'Evidence', history: 'History' },
      evidenceCount_one: '{{count}} observation',
      evidenceCount_other: '{{count}} observations',
      remediation: 'Remediation guidance',
      whyMatched: 'Why this was matched',
      backportWarning:
        'This version carries a distribution revision. Many distributions backport security fixes without changing the upstream version number, so this host may already be patched — confirm against the installed package before acting.',
      remediationSteps: 'Steps',
      references: 'References',
      noRemediation: 'No remediation guidance is available for this issue yet.',
      firstSeen: 'First seen',
      lastSeen: 'Last seen',
      lastVerified: 'Last verified',
      dueDate: 'Due',
      owner: 'Owner',
      unassigned: 'Unassigned',
      lifecycle: {
        mitigated: 'Mitigated',
        verify: 'Verify fix',
        falsePositive: 'False positive',
        riskAccept: 'Risk accept',
        reopen: 'Reopen',
        triage: 'Triage',
        inProgress: 'Start work',
      },
      falsePositiveDialog: {
        title: 'Mark as false positive',
        reasonCode: 'Reason',
        reasonCodes: {
          not_applicable_environment: 'Not applicable to this environment',
          patched_not_reflected: 'Already patched; scan data not yet refreshed',
          false_signature_match: 'False signature match',
          compensating_control: 'Compensating control already in place',
          duplicate_of_other_issue: 'Duplicate of another issue',
          other: 'Other',
        },
        justification: 'Justification',
        submit: 'Mark false positive',
      },
      riskAcceptDialog: {
        title: 'Request risk acceptance',
        justification: 'Justification',
        expiresAt: 'Expires',
        submit: 'Submit for approval',
      },
    },
    empty: {
      title: 'No scope has been authorised yet',
      description: 'Issues appear here once a scan has run against an authorised scope.',
      action: 'Declare a scope',
    },
    bulk: {
      selected_one: '{{count}} issue selected',
      selected_other: '{{count}} issues selected',
      transition: 'Transition selected',
    },
  },
  assets: {
    title: 'Assets',
    columns: {
      identity: 'Asset',
      address: 'Address',
      criticality: 'Criticality',
      exposure: 'Exposure',
      openIssues: 'Open issues',
      lastSeen: 'Last seen',
    },
    detail: {
      tabs: { overview: 'Overview', history: 'History', issues: 'Issues', scans: 'Scan history' },
      identityKeys: 'Identity keys',
      addressHistory: 'Address history',
      hostnameHistory: 'Hostname history',
      services: 'Services',
      tags: 'Tags',
      ownerTeam: 'Owner team',
      fragile: 'Fragile device',
      fragileHint:
        'This asset matched a fragile-device heuristic. Scans against it are auto-downgraded to passive-inventory.',
      mergeCandidates: 'Merge candidates',
      merge: 'Merge',
      split: 'Split merge',
    },
    empty: {
      title: 'No assets discovered yet',
      description: 'Assets appear here after the first scan completes against an authorised scope.',
    },
  },
  scans: {
    title: 'Scans',
    newScan: 'New scan',
    columns: {
      id: 'Scan',
      scope: 'Scope',
      profile: 'Profile',
      status: 'Status',
      progress: 'Progress',
      started: 'Started',
    },
    status: {
      queued: 'Queued',
      running: 'Running',
      paused: 'Paused',
      completed: 'Completed',
      aborted: 'Aborted',
      failed: 'Failed',
    },
    wizard: {
      steps: { scope: 'Scope', profile: 'Profile', schedule: 'Schedule', review: 'Review' },
      scope: { description: 'Choose the authorised scope this scan will run against.' },
      profile: {
        description: 'Choose an intrusiveness profile. New scans default to safe.',
        confirmStandard: 'Type CONFIRM to run the standard profile against this scope.',
        confirmPlaceholder: 'Type CONFIRM',
      },
      schedule: {
        description: 'Run once now, or attach this scan to a recurring schedule.',
        now: 'Run now',
        later: 'Create a schedule',
      },
      review: {
        title: 'Review before starting',
        targetCount: 'Targets',
        estimatedPackets: 'Estimated packet volume',
        estimatedDuration: 'Estimated duration',
        excludedTargets: 'Excluded targets',
        excludedByRule: 'excluded by rule',
        fragileDowngrades: 'Fragile-device downgrades',
        matchedHeuristic: 'matched heuristic',
        pacing: 'Pacing',
        pacingConfiguredVsCeiling: '{{configured}} (ceiling {{ceiling}})',
        start: 'Start scan',
        computing: 'Computing plan…',
      },
    },
    run: {
      targets: 'Targets',
      noTargetsYet: 'No per-target status yet — this appears once the scan starts dispatching.',
      progress: '{{completed}} / {{total}} targets',
      pause: 'Pause',
      resume: 'Resume',
      abort: 'Abort',
      abortConfirm: 'Abort this scan? Queued and in-progress targets will stop.',
      downloadRawArtifacts: 'Download raw artifacts',
    },
    empty: {
      title: 'No scans have run yet',
      description: 'Start a scan against an authorised scope to discover assets and issues.',
    },
  },
  scope: {
    title: 'Scope & exclusions',
    tabs: {
      scopes: 'Authorised scopes',
      exclusions: 'Exclusion rules',
      profiles: 'Scan profiles',
      blackouts: 'Blackout windows',
      schedules: 'Schedules',
    },
    newScope: 'Declare scope',
    newExclusion: 'Add exclusion',
    newProfile: 'New scan profile',
    newBlackout: 'New blackout window',
    edit: 'Edit',
    deactivate: 'Deactivate',
    reactivate: 'Reactivate',
    supersede: 'Supersede',
    superseded: '(superseded)',
    exclusionValue: 'Value',
    exclusionReason: 'Reason',
    exclusionType: { address: 'Address', range: 'Range', port: 'Port', tag: 'Tag' },
    empty: {
      scopes: 'No scopes authorised yet.',
      exclusions: 'No exclusion rules defined.',
      profiles: 'No scan profiles configured.',
      blackouts: 'No blackout windows configured.',
      schedules: 'No schedules configured.',
    },
  },
  exceptions: {
    title: 'Exceptions',
    newRequest: 'Request exception',
    columns: { issue: 'Issue', requestedBy: 'Requested by', status: 'Status', expires: 'Expires' },
    approve: 'Approve',
    reject: 'Reject',
    revoke: 'Revoke',
    expiresIn_one: 'Expires in {{count}} day',
    expiresIn_other: 'Expires in {{count}} days',
    expired: 'Expired',
    empty: {
      title: 'No exceptions on record',
      description: 'Risk-accepted issues with an approved exception appear here.',
    },
  },
  dashboard: {
    title: 'Dashboard',
    tiles: {
      riskPosture: 'Risk posture',
      topIssues: 'Top issues by risk',
      sla: 'SLA compliance',
      coverage: 'Coverage',
      activeScans: 'Active & recent scans',
      exceptionsExpiring: 'Exceptions approaching expiry',
    },
    sla: { onTrack: 'On track', approachingDue: 'Approaching due', overdue: 'Overdue' },
    coverage: { scanned: '{{scanned}} of {{total}} assets scanned in the last 30 days' },
    empty: {
      title: 'Nothing to show yet',
      description: 'Declare a scope and run a scan to populate this dashboard.',
      action: 'Declare a scope',
    },
  },
  account: {
    title: 'Your account',
    identity: {
      title: 'Account',
      name: 'Name',
      email: 'Email',
      role: 'Role',
    },
    mfa: {
      title: 'Two-factor authentication',
      enabled: 'Two-factor authentication is on for this account.',
      notEnabled: 'two-factor off',
      enable: 'Set up two-factor authentication',
      optionalDescription:
        'This appliance does not currently require two-factor authentication, but you can turn it on for your own account. Once enabled, you will be asked for a code from your authenticator app every time you sign in.',
      requiredDescription:
        'Your role requires two-factor authentication. Set it up now to continue using the appliance.',
      disableNote:
        'To remove two-factor authentication from this account, ask an administrator. It cannot be switched off from a signed-in session.',
    },
  },
  reports: {
    title: 'Reports',
    newReport: 'Generate report',
    templates: {
      executive_summary: 'Executive summary',
      technical_detail: 'Technical detail',
      delta: 'Delta between two dates',
    },
    columns: {
      template: 'Template',
      status: 'Status',
      generatedBy: 'Generated by',
      generatedAt: 'Generated',
    },
    download: 'Download',
    dateRangeStart: 'From date',
    dateRangeEnd: 'To date',
    dateRangeRequired: 'A delta report compares two dates — choose both.',
    dateRangeOrder: 'The “from” date must not be after the “to” date.',
    generateFailed: 'The report could not be generated.',
    empty: {
      title: 'No reports generated yet',
      description: 'Generate a report to share risk posture or technical detail with stakeholders.',
    },
  },
  admin: {
    title: 'Administration',
    tabs: {
      users: 'Users',
      notifications: 'Notification channels',
      retention: 'Retention',
      backup: 'Backup',
      featureFlags: 'Feature flags',
      audit: 'Audit log',
      health: 'System health',
      intelligence: 'Intelligence',
    },
    users: {
      invite: 'Add user',
      role: 'Role',
      deactivate: 'Deactivate',
      mfaEnabled: 'MFA',
      active: 'Active',
      inactive: 'Inactive',
    },
    retention: { floorHint: 'The floor for this data class is {{days}} days.' },
    backup: {
      lastBackup: 'Last backup',
      triggerBackup: 'Back up now',
      status: 'Status',
      restoreTested: 'Restore last tested',
      rpo: 'Measured RPO',
      rto: 'Measured RTO',
    },
    audit: {
      chainIntact: 'Audit chain intact',
      chainBroken: 'Audit chain integrity failure detected',
      verify: 'Verify chain',
      export: 'Export',
    },
    health: {
      components: 'Components',
      vulnDataAge: 'Vulnerability data age',
      diskHeadroom: 'Disk headroom',
      queueBacklog: 'Queue backlog',
      degraded: 'Degraded subsystems',
    },
    globalStop: {
      title: 'Global stop',
      description:
        'Immediately halts all queued and running scan activity. This cannot be undone for scans already in progress.',
      confirm: 'Halt all scan activity',
      reason: 'Reason (optional)',
      history: 'Global stop history',
      halted_one: '{{count}} scan halted',
      halted_other: '{{count}} scans halted',
    },
    intel: {
      updateNow: 'Update now',
      onlineUpdatesDisabled:
        'Online intelligence updates are permanently disabled for this deployment.',
      disableOnlineUpdates: 'Disable online updates permanently',
      enableOnlineUpdates: 'Re-enable online updates',
      activeCorpus: 'Active corpus',
      noCorpusYet: 'No successful sync yet.',
      totalVulnerabilities: 'Retained records',
      knownExploited: 'Known-exploited',
      lastSync: 'Last sync attempt',
      syncing: 'Sync in progress…',
      neverSynced: 'Never synced',
      history: 'Sync history',
      status: {
        validating: 'In progress',
        applied: 'Applied',
        failed: 'Failed',
        superseded: 'Superseded',
      },
      failureReason: {
        no_connectivity:
          'No internet connectivity — this is expected for an air-gapped deployment.',
        online_updates_disabled: 'Online updates are disabled for this deployment.',
      },
    },
  },
} as const;

/**
 * Structural type derived from `en` with every leaf string widened to
 * `string` (arrays kept as arrays) — used to type `fa.ts` so a missing or
 * misspelled key is a compile error there, without forcing Persian strings
 * to literally equal their English counterparts (which a plain `typeof en`
 * would do, since `en` is declared `as const`).
 */
export type DeepString<T> = T extends string
  ? string
  : T extends readonly (infer U)[]
    ? readonly DeepString<U>[]
    : { readonly [K in keyof T]: DeepString<T[K]> };

export type TranslationSchema = DeepString<typeof en>;
