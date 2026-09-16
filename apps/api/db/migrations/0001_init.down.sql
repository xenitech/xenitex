-- 0001_init.down.sql
-- Reverse of 0001_init.up.sql, strict reverse dependency order. Roles are
-- dropped LAST -- they hold grants on every table until those tables are gone.

DROP TABLE IF EXISTS backup_records;
DROP TABLE IF EXISTS retention_policies;
DROP TABLE IF EXISTS audit_entries;

DROP TABLE IF EXISTS notification_events;
DROP TABLE IF EXISTS notification_channels;
DROP TABLE IF EXISTS reports;

DROP TABLE IF EXISTS issue_risk_score_snapshots;
ALTER TABLE IF EXISTS issues DROP CONSTRAINT IF EXISTS fk_issues_exception;
DROP TABLE IF EXISTS exceptions;
DROP TABLE IF EXISTS issue_state_history;
DROP TABLE IF EXISTS verification_scans;
DROP TABLE IF EXISTS issue_observations;
DROP TABLE IF EXISTS issues;

DROP TABLE IF EXISTS sla_policies;
DROP TABLE IF EXISTS risk_scoring_policies;

DROP TABLE IF EXISTS asset_group_members;
DROP TABLE IF EXISTS asset_groups;
DROP TABLE IF EXISTS asset_services;
DROP TABLE IF EXISTS asset_hostname_history;
DROP TABLE IF EXISTS asset_address_history;
DROP TABLE IF EXISTS asset_merge_events;
DROP TABLE IF EXISTS identity_resolution_policies;
DROP TABLE IF EXISTS asset_identity_keys;

DROP TABLE IF EXISTS observations;
DROP TABLE IF EXISTS assets;

DROP TABLE IF EXISTS raw_artifacts;
DROP TABLE IF EXISTS remediation_guidance;
DROP TABLE IF EXISTS vulnerabilities;
DROP TABLE IF EXISTS vulnerability_data_imports;

DROP TABLE IF EXISTS global_stop_events;
DROP TABLE IF EXISTS scan_run_targets;
DROP TABLE IF EXISTS scanner_adapters;
DROP TABLE IF EXISTS scan_runs;
DROP TABLE IF EXISTS scan_plan_previews;
DROP TABLE IF EXISTS scan_schedules;
DROP TABLE IF EXISTS blackout_windows;
DROP TABLE IF EXISTS fragile_device_rules;
DROP TABLE IF EXISTS scan_profiles;
DROP TABLE IF EXISTS exclusion_rules;
DROP TABLE IF EXISTS pacing_ceilings;
DROP TABLE IF EXISTS authorized_scopes;

DROP TABLE IF EXISTS feature_flags;
DROP TABLE IF EXISTS organization_settings;

DROP TABLE IF EXISTS auth_events;
DROP TABLE IF EXISTS sessions;
DROP TABLE IF EXISTS mfa_recovery_codes;
DROP TABLE IF EXISTS users;

DROP TABLE IF EXISTS false_positive_reasons;

DROP TYPE IF EXISTS retention_data_class_enum;
DROP TYPE IF EXISTS audit_outcome_enum;
DROP TYPE IF EXISTS notification_status_enum;
DROP TYPE IF EXISTS notification_mode_enum;
DROP TYPE IF EXISTS notification_channel_type_enum;
DROP TYPE IF EXISTS report_status_enum;
DROP TYPE IF EXISTS report_template_enum;
DROP TYPE IF EXISTS verification_outcome_enum;
DROP TYPE IF EXISTS scan_target_status_enum;
DROP TYPE IF EXISTS scan_run_status_enum;
DROP TYPE IF EXISTS exclusion_rule_type_enum;
DROP TYPE IF EXISTS attestation_type_enum;
DROP TYPE IF EXISTS intrusiveness_profile_enum;
DROP TYPE IF EXISTS exception_status_enum;
DROP TYPE IF EXISTS issue_state_enum;
DROP TYPE IF EXISTS identity_key_type_enum;
DROP TYPE IF EXISTS asset_criticality_enum;
DROP TYPE IF EXISTS exposure_classification_enum;
DROP TYPE IF EXISTS asset_lifecycle_state_enum;
DROP TYPE IF EXISTS user_role_enum;

DROP ROLE IF EXISTS xenitex_retention_worker;
DROP ROLE IF EXISTS xenitex_app;
