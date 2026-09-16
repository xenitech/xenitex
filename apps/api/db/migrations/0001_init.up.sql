-- 0001_init.up.sql
-- Translates docs/database-schema.md into a runnable migration. Ordered strictly
-- by foreign-key dependency; the one circular pair (issues <-> exceptions) is
-- resolved with a deferred ALTER TABLE at the end. See that document for the
-- rationale behind every table and column — this file should never drift from
-- it without both being updated in the same PR.

-- ============================================================================
-- Extensions
-- ============================================================================
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS btree_gin;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ============================================================================
-- Enumerated types
-- ============================================================================
CREATE TYPE user_role_enum AS ENUM ('viewer', 'analyst', 'operator', 'administrator');

CREATE TYPE asset_lifecycle_state_enum AS ENUM ('active', 'inactive', 'decommissioned', 'merged');
CREATE TYPE exposure_classification_enum AS ENUM ('internal', 'dmz', 'external', 'unknown');
CREATE TYPE asset_criticality_enum AS ENUM ('low', 'medium', 'high', 'critical');

CREATE TYPE identity_key_type_enum AS ENUM ('machine_uuid', 'serial_number', 'mac_address', 'fqdn', 'certificate_fingerprint');

CREATE TYPE issue_state_enum AS ENUM (
  'new', 'triaged', 'in_progress', 'mitigated',
  'verified_resolved', 'reopened', 'false_positive', 'risk_accepted'
);
CREATE TYPE exception_status_enum AS ENUM ('pending', 'approved', 'rejected', 'expired', 'revoked');

CREATE TYPE intrusiveness_profile_enum AS ENUM ('passive-inventory', 'safe', 'standard');
CREATE TYPE attestation_type_enum AS ENUM ('self_attested_owner', 'delegated_authority', 'contract_engagement', 'other');
CREATE TYPE exclusion_rule_type_enum AS ENUM ('address', 'range', 'port', 'tag');

CREATE TYPE scan_run_status_enum AS ENUM ('queued', 'running', 'paused', 'completed', 'aborted', 'failed');
CREATE TYPE scan_target_status_enum AS ENUM (
  'pending', 'in_progress', 'completed', 'failed',
  'excluded', 'skipped_blackout', 'skipped_fragile_downgrade'
);
CREATE TYPE verification_outcome_enum AS ENUM ('pending', 'confirmed_resolved', 'still_present', 'inconclusive');

CREATE TYPE report_template_enum AS ENUM ('executive_summary', 'technical_detail', 'delta');
CREATE TYPE report_status_enum AS ENUM ('pending', 'completed', 'failed');

CREATE TYPE notification_channel_type_enum AS ENUM ('email', 'webhook');
CREATE TYPE notification_mode_enum AS ENUM ('immediate', 'digest');
CREATE TYPE notification_status_enum AS ENUM ('pending', 'sent', 'failed');

CREATE TYPE audit_outcome_enum AS ENUM ('success', 'failure', 'denied');

CREATE TYPE retention_data_class_enum AS ENUM ('raw_artifacts', 'observations', 'resolved_issues', 'audit_log');

-- ============================================================================
-- Controlled vocabulary
-- ============================================================================
CREATE TABLE false_positive_reasons (
  code            text PRIMARY KEY,
  label           text NOT NULL,
  description     text NOT NULL,
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now()
);

INSERT INTO false_positive_reasons (code, label, description) VALUES
  ('not_applicable_environment', 'Not applicable to this environment', 'The underlying condition does not apply given how this asset is actually deployed or configured.'),
  ('patched_not_reflected', 'Patched but not yet reflected', 'A fix is already applied; the scanner signature has not caught up.'),
  ('false_signature_match', 'False signature match', 'The detection matched a banner or fingerprint that does not indicate the vulnerable condition.'),
  ('compensating_control', 'Compensating control in place', 'A control outside the scanned surface mitigates the underlying risk.'),
  ('duplicate_of_other_issue', 'Duplicate of another issue', 'Corrects a deduplication gap rather than disputing the finding itself.'),
  ('other', 'Other', 'Reason not covered by the above; justification is required.');

-- ============================================================================
-- Identity, access, sessions
-- ============================================================================
CREATE TABLE users (
  id                    uuid PRIMARY KEY,
  email                 citext NOT NULL UNIQUE,
  display_name          text NOT NULL,
  role                  user_role_enum NOT NULL,
  password_hash         text NOT NULL,
  password_changed_at   timestamptz NOT NULL DEFAULT now(),
  mfa_enabled           boolean NOT NULL DEFAULT false,
  mfa_secret_ref        text,
  is_active             boolean NOT NULL DEFAULT true,
  failed_login_count    integer NOT NULL DEFAULT 0,
  locked_until          timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mfa_required_for_privileged_roles
    CHECK (role NOT IN ('operator', 'administrator') OR mfa_enabled)
);

CREATE TABLE mfa_recovery_codes (
  id           uuid PRIMARY KEY,
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash    text NOT NULL,
  used_at      timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_mfa_recovery_codes_user ON mfa_recovery_codes(user_id) WHERE used_at IS NULL;

CREATE TABLE sessions (
  id                    uuid PRIMARY KEY,
  user_id               uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_token_hash    text NOT NULL UNIQUE,
  csrf_token_hash       text NOT NULL,
  source_address        inet NOT NULL,
  user_agent            text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  last_seen_at          timestamptz NOT NULL DEFAULT now(),
  idle_expires_at       timestamptz NOT NULL,
  absolute_expires_at   timestamptz NOT NULL,
  revoked_at            timestamptz,
  revoked_reason        text
);
CREATE INDEX idx_sessions_user ON sessions(user_id) WHERE revoked_at IS NULL;

CREATE TABLE auth_events (
  id                 bigserial PRIMARY KEY,
  event_type         text NOT NULL CHECK (event_type IN ('login_success','login_failure','lockout','export','scan_creation')),
  actor_identifier   text NOT NULL,
  source_address     inet NOT NULL,
  occurred_at        timestamptz NOT NULL DEFAULT now(),
  metadata           jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX idx_auth_events_lookup ON auth_events(actor_identifier, source_address, occurred_at DESC);

-- ============================================================================
-- Organisation settings and feature flags
-- ============================================================================
CREATE TABLE organization_settings (
  id                        smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  organization_name         text NOT NULL,
  timezone                  text NOT NULL,
  tls_mode                  text NOT NULL DEFAULT 'self_signed' CHECK (tls_mode IN ('self_signed', 'customer_certificate')),
  setup_completed_at        timestamptz,
  safety_defaults_acknowledged_by   uuid REFERENCES users(id),
  safety_defaults_acknowledged_at   timestamptz,
  updated_at                timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE feature_flags (
  key            text PRIMARY KEY,
  description    text NOT NULL,
  is_enabled     boolean NOT NULL DEFAULT false,
  updated_by     uuid REFERENCES users(id),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

INSERT INTO feature_flags (key, description, is_enabled) VALUES
  ('remediation_executor_enabled', 'Rung 3 execution capability (EXT-09) -- no implementation exists in this codebase', false);

-- ============================================================================
-- Scan safety and scope configuration
-- ============================================================================
CREATE TABLE authorized_scopes (
  id                   uuid PRIMARY KEY,
  name                 text NOT NULL,
  cidr_ranges          cidr[] NOT NULL DEFAULT '{}',
  hostnames            text[] NOT NULL DEFAULT '{}',
  attestation_type     attestation_type_enum NOT NULL,
  attestation_details  text NOT NULL,
  accepted_by_user_id  uuid NOT NULL REFERENCES users(id),
  accepted_at          timestamptz NOT NULL DEFAULT now(),
  superseded_by_id     uuid REFERENCES authorized_scopes(id),
  CONSTRAINT scope_has_targets CHECK (cardinality(cidr_ranges) > 0 OR cardinality(hostnames) > 0)
);
CREATE INDEX idx_authorized_scopes_active ON authorized_scopes(id) WHERE superseded_by_id IS NULL;

CREATE TABLE pacing_ceilings (
  id                              smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  max_packets_per_second          integer NOT NULL,
  max_concurrent_hosts            integer NOT NULL,
  max_concurrent_ports_per_host   integer NOT NULL,
  max_timeout_ms                  integer NOT NULL,
  max_retries                     integer NOT NULL,
  updated_by                      uuid REFERENCES users(id),
  updated_at                      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE exclusion_rules (
  id            uuid PRIMARY KEY,
  scope_id      uuid REFERENCES authorized_scopes(id),
  rule_type     exclusion_rule_type_enum NOT NULL,
  value         text NOT NULL,
  reason        text NOT NULL,
  created_by    uuid NOT NULL REFERENCES users(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  is_active     boolean NOT NULL DEFAULT true
);
CREATE INDEX idx_exclusion_rules_active ON exclusion_rules(scope_id) WHERE is_active;

CREATE TABLE scan_profiles (
  id                       uuid PRIMARY KEY,
  name                     text NOT NULL,
  intrusiveness            intrusiveness_profile_enum NOT NULL DEFAULT 'safe',
  pacing                   jsonb NOT NULL,
  requires_confirmation    boolean NOT NULL DEFAULT false,
  created_by               uuid NOT NULL REFERENCES users(id),
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE fragile_device_rules (
  id              uuid PRIMARY KEY,
  device_class    text NOT NULL,
  match_criteria  jsonb NOT NULL,
  action          text NOT NULL DEFAULT 'downgrade_to_passive_inventory',
  is_enabled      boolean NOT NULL DEFAULT true
);

CREATE TABLE blackout_windows (
  id            uuid PRIMARY KEY,
  scope_id      uuid REFERENCES authorized_scopes(id),
  name          text NOT NULL,
  timezone      text NOT NULL,
  starts_at     timestamptz NOT NULL,
  ends_at       timestamptz NOT NULL,
  is_recurring  boolean NOT NULL DEFAULT false,
  rrule         text,
  created_by    uuid NOT NULL REFERENCES users(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT blackout_window_valid_range CHECK (ends_at > starts_at)
);

CREATE TABLE scan_schedules (
  id                uuid PRIMARY KEY,
  name              text NOT NULL,
  scope_id          uuid NOT NULL REFERENCES authorized_scopes(id),
  profile_id        uuid NOT NULL REFERENCES scan_profiles(id),
  cron_expression   text NOT NULL,
  timezone          text NOT NULL,
  next_run_at       timestamptz,
  is_enabled        boolean NOT NULL DEFAULT true,
  created_by        uuid NOT NULL REFERENCES users(id),
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE scan_plan_previews (
  id                      uuid PRIMARY KEY,
  scope_id                uuid NOT NULL REFERENCES authorized_scopes(id),
  profile_id              uuid NOT NULL REFERENCES scan_profiles(id),
  target_count            integer NOT NULL,
  estimated_packet_volume bigint NOT NULL,
  estimated_duration_seconds integer NOT NULL,
  excluded_targets        jsonb NOT NULL DEFAULT '[]'::jsonb,
  fragile_downgrades      jsonb NOT NULL DEFAULT '[]'::jsonb,
  generated_at            timestamptz NOT NULL DEFAULT now(),
  confirmed_by_user_id    uuid REFERENCES users(id),
  confirmed_at            timestamptz
);

CREATE TABLE scan_runs (
  id                     uuid PRIMARY KEY,
  plan_preview_id        uuid NOT NULL REFERENCES scan_plan_previews(id),
  scope_id               uuid NOT NULL REFERENCES authorized_scopes(id),
  profile_id             uuid NOT NULL REFERENCES scan_profiles(id),
  schedule_id            uuid REFERENCES scan_schedules(id),
  initiated_by_user_id   uuid REFERENCES users(id),
  status                 scan_run_status_enum NOT NULL DEFAULT 'queued',
  correlation_id         uuid NOT NULL,
  queued_at              timestamptz NOT NULL DEFAULT now(),
  started_at             timestamptz,
  paused_at              timestamptz,
  completed_at           timestamptz,
  aborted_by_user_id     uuid REFERENCES users(id),
  aborted_reason         text,
  CONSTRAINT scan_run_requires_initiator CHECK (schedule_id IS NOT NULL OR initiated_by_user_id IS NOT NULL)
);
CREATE INDEX idx_scan_runs_status ON scan_runs(status) WHERE status IN ('queued', 'running', 'paused');

CREATE TABLE scanner_adapters (
  id                uuid PRIMARY KEY,
  adapter_key       text NOT NULL,
  version           text NOT NULL,
  fidelity_rating   numeric(3,2) NOT NULL CHECK (fidelity_rating BETWEEN 0 AND 1),
  capabilities      jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_enabled        boolean NOT NULL DEFAULT true,
  UNIQUE (adapter_key, version)
);

CREATE TABLE scan_run_targets (
  id                     uuid PRIMARY KEY,
  scan_run_id            uuid NOT NULL REFERENCES scan_runs(id) ON DELETE CASCADE,
  target_address         text NOT NULL,
  target_port            integer,
  status                 scan_target_status_enum NOT NULL DEFAULT 'pending',
  excluded_by_rule_id    uuid REFERENCES exclusion_rules(id),
  fragile_rule_id        uuid REFERENCES fragile_device_rules(id),
  adapter_key            text NOT NULL,
  started_at             timestamptz,
  completed_at           timestamptz,
  failure_class          text
);
CREATE INDEX idx_scan_run_targets_run ON scan_run_targets(scan_run_id, status);

CREATE TABLE global_stop_events (
  id                    uuid PRIMARY KEY,
  invoked_by_user_id    uuid REFERENCES users(id),
  invoked_via           text NOT NULL CHECK (invoked_via IN ('web', 'cli')),
  invoked_at            timestamptz NOT NULL DEFAULT now(),
  reason                text,
  scan_runs_halted      uuid[] NOT NULL DEFAULT '{}'
);

-- ============================================================================
-- Vulnerability intelligence
-- ============================================================================
CREATE TABLE vulnerability_data_imports (
  id                  uuid PRIMARY KEY,
  source_name         text NOT NULL,
  source_version      text NOT NULL,
  bundle_signature    text NOT NULL,
  status              text NOT NULL DEFAULT 'validating' CHECK (status IN ('validating', 'applied', 'failed', 'superseded')),
  record_counts       jsonb,
  imported_by         uuid REFERENCES users(id),
  imported_at         timestamptz NOT NULL DEFAULT now(),
  superseded_by_id    uuid REFERENCES vulnerability_data_imports(id)
);

CREATE TABLE vulnerabilities (
  id                    uuid PRIMARY KEY,
  vuln_identifier       text NOT NULL UNIQUE,
  cve_ids               text[] NOT NULL DEFAULT '{}',
  cwe_ids               text[] NOT NULL DEFAULT '{}',
  affected_cpes         jsonb NOT NULL DEFAULT '[]'::jsonb,
  cvss_vector           text,
  cvss_base_score       numeric(3,1) CHECK (cvss_base_score BETWEEN 0 AND 10),
  exploit_probability   numeric(5,4) CHECK (exploit_probability BETWEEN 0 AND 1),
  known_exploited       boolean NOT NULL DEFAULT false,
  known_exploited_source text,
  published_at          timestamptz,
  modified_at           timestamptz,
  description           text,
  canonical_remediation text,
  data_import_id        uuid NOT NULL REFERENCES vulnerability_data_imports(id),
  created_at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_vulnerabilities_cve_ids ON vulnerabilities USING gin (cve_ids);
CREATE INDEX idx_vulnerabilities_known_exploited ON vulnerabilities(known_exploited) WHERE known_exploited;

CREATE TABLE remediation_guidance (
  id                  uuid PRIMARY KEY,
  match_type          text NOT NULL CHECK (match_type IN ('cve', 'cpe', 'issue_type')),
  match_value         text NOT NULL,
  priority_rationale  text NOT NULL,
  remediation_steps   text NOT NULL,
  "references"        jsonb NOT NULL DEFAULT '[]'::jsonb,
  version             integer NOT NULL DEFAULT 1,
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_remediation_guidance_match ON remediation_guidance(match_type, match_value);

-- ============================================================================
-- Evidence: raw artifacts and observations
-- ============================================================================
CREATE TABLE raw_artifacts (
  id                 uuid PRIMARY KEY,
  scan_run_id        uuid NOT NULL REFERENCES scan_runs(id),
  scanner_adapter_id uuid NOT NULL REFERENCES scanner_adapters(id),
  blob_store_key     text NOT NULL,
  content_type       text NOT NULL,
  size_bytes         bigint NOT NULL,
  sha256             text NOT NULL,
  captured_at        timestamptz NOT NULL DEFAULT now(),
  retention_class    retention_data_class_enum NOT NULL DEFAULT 'raw_artifacts',
  purge_after        timestamptz
);
CREATE INDEX idx_raw_artifacts_scan_run ON raw_artifacts(scan_run_id);
CREATE INDEX idx_raw_artifacts_purge ON raw_artifacts(purge_after) WHERE purge_after IS NOT NULL;

-- ============================================================================
-- Assets
-- ============================================================================
CREATE TABLE assets (
  id                     uuid PRIMARY KEY,
  lifecycle_state        asset_lifecycle_state_enum NOT NULL DEFAULT 'active',
  merged_into_asset_id   uuid REFERENCES assets(id),
  os_inference           text,
  os_inference_confidence numeric(3,2) CHECK (os_inference_confidence BETWEEN 0 AND 1),
  owner_team             text,
  business_criticality   asset_criticality_enum NOT NULL DEFAULT 'medium',
  exposure_classification exposure_classification_enum NOT NULL DEFAULT 'unknown',
  tags                   text[] NOT NULL DEFAULT '{}',
  is_fragile             boolean NOT NULL DEFAULT false,
  first_seen             timestamptz NOT NULL DEFAULT now(),
  last_seen              timestamptz NOT NULL DEFAULT now(),
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT merged_asset_has_target CHECK (lifecycle_state <> 'merged' OR merged_into_asset_id IS NOT NULL)
);
CREATE INDEX idx_assets_lifecycle ON assets(lifecycle_state) WHERE lifecycle_state = 'active';
CREATE INDEX idx_assets_tags ON assets USING gin (tags);

-- ============================================================================
-- Observations (depends on scan_runs, scanner_adapters, raw_artifacts, assets)
-- ============================================================================
CREATE TABLE observations (
  id                     uuid PRIMARY KEY,
  scan_run_id            uuid NOT NULL REFERENCES scan_runs(id),
  scanner_adapter_id     uuid NOT NULL REFERENCES scanner_adapters(id),
  raw_artifact_id        uuid NOT NULL REFERENCES raw_artifacts(id),
  target_address         text NOT NULL,
  target_port            integer,
  target_protocol        text,
  resolved_asset_id      uuid REFERENCES assets(id),
  extracted_attributes   jsonb NOT NULL DEFAULT '{}'::jsonb,
  untrusted_evidence     jsonb NOT NULL DEFAULT '{}'::jsonb,
  observed_at            timestamptz NOT NULL,
  created_at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_observations_scan_run ON observations(scan_run_id);
CREATE INDEX idx_observations_resolved_asset ON observations(resolved_asset_id) WHERE resolved_asset_id IS NOT NULL;
CREATE INDEX idx_observations_target ON observations(target_address, target_port);

-- ============================================================================
-- Identity resolution (depends on assets, observations, users)
-- ============================================================================
CREATE TABLE asset_identity_keys (
  id             uuid PRIMARY KEY,
  asset_id       uuid NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  key_type       identity_key_type_enum NOT NULL,
  key_value      text NOT NULL,
  source_observation_id uuid REFERENCES observations(id),
  confidence     numeric(3,2) NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  first_seen     timestamptz NOT NULL DEFAULT now(),
  last_seen      timestamptz NOT NULL DEFAULT now(),
  is_active      boolean NOT NULL DEFAULT true
);
CREATE UNIQUE INDEX uq_asset_identity_key_value ON asset_identity_keys(key_type, key_value) WHERE is_active;
CREATE INDEX idx_asset_identity_keys_asset ON asset_identity_keys(asset_id);

CREATE TABLE identity_resolution_policies (
  id                uuid PRIMARY KEY,
  version           integer NOT NULL UNIQUE,
  precedence_order  identity_key_type_enum[] NOT NULL,
  merge_rules       jsonb NOT NULL,
  is_active         boolean NOT NULL DEFAULT false,
  created_by        uuid NOT NULL REFERENCES users(id),
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_one_active_identity_policy ON identity_resolution_policies(is_active) WHERE is_active;

CREATE TABLE asset_merge_events (
  id                        uuid PRIMARY KEY,
  survivor_asset_id         uuid NOT NULL REFERENCES assets(id),
  merged_asset_id           uuid NOT NULL REFERENCES assets(id),
  matched_identity_key_id   uuid REFERENCES asset_identity_keys(id),
  policy_version            integer NOT NULL REFERENCES identity_resolution_policies(version),
  confidence                numeric(3,2) NOT NULL,
  performed_by              uuid REFERENCES users(id),
  performed_at              timestamptz NOT NULL DEFAULT now(),
  reversed_by               uuid REFERENCES users(id),
  reversed_at               timestamptz,
  reversal_reason           text,
  CONSTRAINT distinct_assets CHECK (survivor_asset_id <> merged_asset_id)
);
CREATE INDEX idx_asset_merge_events_pending_review ON asset_merge_events(confidence) WHERE reversed_at IS NULL;

CREATE TABLE asset_address_history (
  id           uuid PRIMARY KEY,
  asset_id     uuid NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  address      inet NOT NULL,
  first_seen   timestamptz NOT NULL DEFAULT now(),
  last_seen    timestamptz NOT NULL DEFAULT now(),
  is_current   boolean NOT NULL DEFAULT true
);
CREATE INDEX idx_asset_address_history_asset ON asset_address_history(asset_id);
CREATE INDEX idx_asset_address_history_address ON asset_address_history(address) WHERE is_current;

CREATE TABLE asset_hostname_history (
  id           uuid PRIMARY KEY,
  asset_id     uuid NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  hostname     text NOT NULL,
  first_seen   timestamptz NOT NULL DEFAULT now(),
  last_seen    timestamptz NOT NULL DEFAULT now(),
  is_current   boolean NOT NULL DEFAULT true
);
CREATE INDEX idx_asset_hostname_history_asset ON asset_hostname_history(asset_id);

CREATE TABLE asset_services (
  id            uuid PRIMARY KEY,
  asset_id      uuid NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  port          integer NOT NULL,
  protocol      text NOT NULL,
  service_name_untrusted  text,
  product_untrusted       text,
  version_untrusted       text,
  first_seen    timestamptz NOT NULL DEFAULT now(),
  last_seen     timestamptz NOT NULL DEFAULT now(),
  is_current    boolean NOT NULL DEFAULT true
);
CREATE UNIQUE INDEX uq_asset_service ON asset_services(asset_id, port, protocol) WHERE is_current;

CREATE TABLE asset_groups (
  id              uuid PRIMARY KEY,
  name            text NOT NULL,
  description     text,
  is_dynamic      boolean NOT NULL DEFAULT false,
  dynamic_filter  jsonb,
  created_by      uuid NOT NULL REFERENCES users(id),
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE asset_group_members (
  asset_group_id  uuid NOT NULL REFERENCES asset_groups(id) ON DELETE CASCADE,
  asset_id        uuid NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  added_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (asset_group_id, asset_id)
);

-- ============================================================================
-- Risk scoring policy (depends on users; referenced by issues)
-- ============================================================================
CREATE TABLE risk_scoring_policies (
  id             uuid PRIMARY KEY,
  version        integer NOT NULL UNIQUE,
  weights        jsonb NOT NULL,
  is_active      boolean NOT NULL DEFAULT false,
  created_by     uuid NOT NULL REFERENCES users(id),
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_one_active_risk_policy ON risk_scoring_policies(is_active) WHERE is_active;

-- ============================================================================
-- SLA policy matrix (referenced by issues)
-- ============================================================================
CREATE TABLE sla_policies (
  id                  uuid PRIMARY KEY,
  name                text NOT NULL,
  risk_band           text NOT NULL CHECK (risk_band IN ('low','medium','high','critical')),
  asset_criticality   asset_criticality_enum NOT NULL,
  due_within_days     integer NOT NULL,
  version             integer NOT NULL DEFAULT 1,
  is_active           boolean NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_sla_policy_matrix ON sla_policies(risk_band, asset_criticality) WHERE is_active;

-- ============================================================================
-- Issues (exception_id FK deferred -- see the ALTER TABLE at the end of this file)
-- ============================================================================
CREATE TABLE issues (
  id                     uuid PRIMARY KEY,
  fingerprint            text NOT NULL,
  fingerprint_version    smallint NOT NULL,
  asset_id               uuid NOT NULL REFERENCES assets(id),
  vulnerability_id       uuid REFERENCES vulnerabilities(id),
  port                   integer,
  protocol               text,
  service_untrusted      text,
  product_untrusted      text,
  version_untrusted      text,
  severity               text NOT NULL,
  risk_score             numeric(6,2) NOT NULL,
  risk_score_policy_version integer NOT NULL REFERENCES risk_scoring_policies(version),
  confidence             numeric(3,2) NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  -- Postgres does not treat a text->enum cast as IMMUTABLE, so a GENERATED
  -- column cannot be typed confidence_label_enum directly; it's `text`
  -- constrained to the same value set instead (MOD-19/MOD-20).
  confidence_label       text GENERATED ALWAYS AS (
                           CASE WHEN confidence >= 0.75 THEN 'high'
                                WHEN confidence >= 0.4 THEN 'medium'
                                ELSE 'low' END
                         ) STORED,
  state                  issue_state_enum NOT NULL DEFAULT 'new',
  owner_user_id          uuid REFERENCES users(id),
  due_date               date,
  sla_policy_id          uuid REFERENCES sla_policies(id),
  exception_id           uuid, -- FK added after `exceptions` exists, see bottom of file
  first_seen             timestamptz NOT NULL DEFAULT now(),
  last_seen              timestamptz NOT NULL DEFAULT now(),
  last_verified_at       timestamptz,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_issue_fingerprint ON issues(fingerprint, fingerprint_version);
CREATE INDEX idx_issues_state ON issues(state);
CREATE INDEX idx_issues_asset ON issues(asset_id);
CREATE INDEX idx_issues_risk_score ON issues(risk_score DESC) WHERE state NOT IN ('false_positive', 'verified_resolved');
CREATE INDEX idx_issues_due_date ON issues(due_date) WHERE state NOT IN ('verified_resolved', 'false_positive', 'risk_accepted');
CREATE INDEX idx_issues_confidence ON issues(confidence);

CREATE TABLE issue_observations (
  issue_id           uuid NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  observation_id     uuid NOT NULL REFERENCES observations(id),
  corroboration_weight numeric(3,2) NOT NULL DEFAULT 1.0,
  attached_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (issue_id, observation_id)
);

CREATE TABLE verification_scans (
  id                 uuid PRIMARY KEY,
  issue_id           uuid NOT NULL REFERENCES issues(id),
  scan_run_id        uuid NOT NULL REFERENCES scan_runs(id),
  requested_by       uuid REFERENCES users(id),
  requested_at       timestamptz NOT NULL DEFAULT now(),
  outcome            verification_outcome_enum NOT NULL DEFAULT 'pending',
  resolved_at        timestamptz
);
CREATE INDEX idx_verification_scans_issue ON verification_scans(issue_id);

CREATE TABLE issue_state_history (
  id                 uuid PRIMARY KEY,
  issue_id           uuid NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  from_state         issue_state_enum,
  to_state           issue_state_enum NOT NULL,
  actor_user_id      uuid REFERENCES users(id),
  reason_code        text REFERENCES false_positive_reasons(code),
  justification       text,
  verification_scan_id uuid REFERENCES verification_scans(id),
  transitioned_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT verified_resolved_is_system_only
    CHECK (to_state <> 'verified_resolved' OR actor_user_id IS NULL),
  CONSTRAINT false_positive_requires_reason
    CHECK (to_state <> 'false_positive' OR (reason_code IS NOT NULL AND justification IS NOT NULL AND actor_user_id IS NOT NULL))
);
CREATE INDEX idx_issue_state_history_issue ON issue_state_history(issue_id, transitioned_at);

CREATE TABLE exceptions (
  id                 uuid PRIMARY KEY,
  issue_id           uuid NOT NULL REFERENCES issues(id),
  requested_by       uuid NOT NULL REFERENCES users(id),
  requested_at       timestamptz NOT NULL DEFAULT now(),
  justification      text NOT NULL,
  approver_user_id   uuid REFERENCES users(id),
  approved_at        timestamptz,
  expires_at         timestamptz NOT NULL,
  status             exception_status_enum NOT NULL DEFAULT 'pending',
  revoked_by         uuid REFERENCES users(id),
  revoked_at         timestamptz,
  revoked_reason     text,
  CONSTRAINT approver_not_requester CHECK (approver_user_id IS DISTINCT FROM requested_by),
  -- MOD-12 GATE 1-accepted maximum: 365 days from request (docs/database-schema.md, section 16).
  CONSTRAINT exception_expiry_within_documented_maximum
    CHECK (expires_at <= requested_at + interval '365 days')
);
CREATE INDEX idx_exceptions_expiring ON exceptions(expires_at) WHERE status = 'approved';

-- Deferred FK closing the issues <-> exceptions cycle (see migrations/README.md).
ALTER TABLE issues
  ADD CONSTRAINT fk_issues_exception FOREIGN KEY (exception_id) REFERENCES exceptions(id);

CREATE TABLE issue_risk_score_snapshots (
  id                      uuid PRIMARY KEY,
  issue_id                uuid NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  scoring_policy_version  integer NOT NULL REFERENCES risk_scoring_policies(version),
  total_score             numeric(6,2) NOT NULL,
  factor_breakdown        jsonb NOT NULL,
  trigger                 text NOT NULL CHECK (trigger IN ('initial_score', 'new_observation', 'weights_changed', 'manual_recompute', 'vuln_data_updated')),
  computed_at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_issue_risk_score_snapshots_issue ON issue_risk_score_snapshots(issue_id, computed_at DESC);

-- ============================================================================
-- Reporting and notifications
-- ============================================================================
CREATE TABLE reports (
  id                uuid PRIMARY KEY,
  template          report_template_enum NOT NULL,
  scope_filter      jsonb NOT NULL DEFAULT '{}'::jsonb,
  date_range_start  date,
  date_range_end    date,
  status            report_status_enum NOT NULL DEFAULT 'pending',
  data_versions     jsonb,
  formats           text[] NOT NULL DEFAULT '{html}',
  blob_store_key    text,
  generated_by      uuid NOT NULL REFERENCES users(id),
  generated_at      timestamptz NOT NULL DEFAULT now(),
  completed_at      timestamptz
);

CREATE TABLE notification_channels (
  id            uuid PRIMARY KEY,
  type          notification_channel_type_enum NOT NULL,
  config        jsonb NOT NULL,
  secret_ref    text,
  is_enabled    boolean NOT NULL DEFAULT true,
  created_by    uuid NOT NULL REFERENCES users(id),
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE notification_events (
  id            uuid PRIMARY KEY,
  channel_id    uuid NOT NULL REFERENCES notification_channels(id),
  event_type    text NOT NULL CHECK (event_type IN ('scan_completed','new_high_risk_issue','sla_breach','exception_expiry','system_degraded')),
  mode          notification_mode_enum NOT NULL DEFAULT 'immediate',
  payload       jsonb NOT NULL,
  status        notification_status_enum NOT NULL DEFAULT 'pending',
  attempted_at  timestamptz,
  delivered_at  timestamptz,
  error         text
);
CREATE INDEX idx_notification_events_pending ON notification_events(status) WHERE status = 'pending';

-- ============================================================================
-- Audit, retention, backup
-- ============================================================================
CREATE TABLE audit_entries (
  id                 bigserial PRIMARY KEY,
  actor_user_id      uuid REFERENCES users(id),
  session_id         uuid REFERENCES sessions(id),
  source_address     inet,
  action             text NOT NULL,
  target_type        text NOT NULL,
  target_id          text NOT NULL,
  before_state       jsonb,
  after_state        jsonb,
  outcome            audit_outcome_enum NOT NULL,
  occurred_at        timestamptz NOT NULL DEFAULT now(),
  canonical_payload  jsonb NOT NULL,
  prev_entry_hash    text NOT NULL,
  entry_hash         text NOT NULL UNIQUE
);
CREATE INDEX idx_audit_entries_actor ON audit_entries(actor_user_id, occurred_at DESC);
CREATE INDEX idx_audit_entries_target ON audit_entries(target_type, target_id);

CREATE TABLE retention_policies (
  data_class          retention_data_class_enum PRIMARY KEY,
  retention_days       integer NOT NULL,
  minimum_floor_days   integer NOT NULL,
  updated_by           uuid REFERENCES users(id),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT retention_respects_floor CHECK (retention_days >= minimum_floor_days)
);

-- GATE 1-accepted figures (see docs/database-schema.md, section 16): the audit
-- floor is a 1-year MVP-pilot baseline, not tied to a specific regulatory regime.
INSERT INTO retention_policies (data_class, retention_days, minimum_floor_days) VALUES
  ('audit_log', 365, 365),
  ('raw_artifacts', 180, 30),
  ('observations', 365, 30),
  ('resolved_issues', 730, 90);

CREATE TABLE backup_records (
  id                    uuid PRIMARY KEY,
  started_at            timestamptz NOT NULL,
  completed_at          timestamptz,
  status                text NOT NULL CHECK (status IN ('running','completed','failed')),
  archive_location      text NOT NULL,
  size_bytes            bigint,
  checksum              text,
  encrypted             boolean NOT NULL DEFAULT true,
  restore_tested_at     timestamptz,
  measured_rpo_seconds  integer,
  measured_rto_seconds  integer
);

-- ============================================================================
-- Application-role privilege lockdown (DATA-02/MOD-03 immutability)
-- ============================================================================
-- The `xenitex_app` role is what apps/api and apps/worker connect as. Creating
-- it here (rather than assuming it pre-exists) keeps the migration
-- self-contained; a real deployment still manages the role's password via
-- SEC-05 secret handling, not this file.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'xenitex_app') THEN
    CREATE ROLE xenitex_app LOGIN;
  END IF;
END
$$;

GRANT ALL ON ALL TABLES IN SCHEMA public TO xenitex_app;
REVOKE UPDATE, DELETE ON observations FROM xenitex_app;
REVOKE UPDATE, DELETE ON audit_entries FROM xenitex_app;
REVOKE UPDATE, DELETE ON raw_artifacts FROM xenitex_app;

-- A separate, narrowly-scoped role is the only one permitted to delete rows
-- from the append-only tables above, and only the retention worker connects as it.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'xenitex_retention_worker') THEN
    CREATE ROLE xenitex_retention_worker LOGIN;
  END IF;
END
$$;

GRANT DELETE ON observations, audit_entries, raw_artifacts TO xenitex_retention_worker;
GRANT SELECT ON retention_policies TO xenitex_retention_worker;
