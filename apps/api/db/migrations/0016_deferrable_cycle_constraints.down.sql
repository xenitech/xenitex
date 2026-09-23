ALTER TABLE issues
  DROP CONSTRAINT fk_issues_exception,
  ADD CONSTRAINT fk_issues_exception FOREIGN KEY (exception_id) REFERENCES exceptions(id);

ALTER TABLE asset_identity_keys
  DROP CONSTRAINT asset_identity_keys_source_observation_id_fkey,
  ADD CONSTRAINT asset_identity_keys_source_observation_id_fkey
    FOREIGN KEY (source_observation_id) REFERENCES observations(id);
