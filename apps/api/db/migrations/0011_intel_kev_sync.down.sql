DROP TABLE IF EXISTS intel_settings;
ALTER TABLE vulnerabilities DROP COLUMN IF EXISTS cvss_version;
ALTER TABLE vulnerability_data_imports DROP COLUMN IF EXISTS failure_reason;
ALTER TABLE vulnerability_data_imports DROP COLUMN IF EXISTS content_sha256;
ALTER TABLE vulnerability_data_imports ALTER COLUMN bundle_signature SET NOT NULL;
