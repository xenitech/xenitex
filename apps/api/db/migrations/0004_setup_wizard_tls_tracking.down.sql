UPDATE organization_settings SET tls_mode = 'self_signed' WHERE tls_mode IS NULL;
ALTER TABLE organization_settings ALTER COLUMN tls_mode SET NOT NULL;
ALTER TABLE organization_settings ALTER COLUMN tls_mode SET DEFAULT 'self_signed';
