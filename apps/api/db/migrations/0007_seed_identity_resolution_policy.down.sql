DELETE FROM identity_resolution_policies WHERE version = 1;
ALTER TABLE identity_resolution_policies ALTER COLUMN created_by SET NOT NULL;
