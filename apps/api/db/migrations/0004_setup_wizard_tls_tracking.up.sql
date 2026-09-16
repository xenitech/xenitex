-- SetupStatus.tlsConfigured (P1-06) needs to distinguish "the wizard's TLS
-- step ran" from "no one has touched this yet" -- but tls_mode's NOT NULL
-- DEFAULT 'self_signed' made every organization_settings row look
-- TLS-configured the instant it was created, before /setup/tls ever ran.
-- Dropping the default and NOT NULL makes NULL mean exactly "not yet
-- chosen"; the /setup/tls handler is what ever sets a real value.
ALTER TABLE organization_settings ALTER COLUMN tls_mode DROP DEFAULT;
ALTER TABLE organization_settings ALTER COLUMN tls_mode DROP NOT NULL;
