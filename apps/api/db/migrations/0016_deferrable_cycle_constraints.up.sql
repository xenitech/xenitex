-- DATA-05. The schema contains two genuine foreign-key CYCLES:
--
--   issues.exception_id          -> exceptions(id)
--   exceptions.issue_id          -> issues(id)
--
--   asset_identity_keys.source_observation_id -> observations(id)
--   observations.resolved_asset_id            -> assets(id) -> ... -> asset_identity_keys
--
-- Both are deliberate (0001_init.up.sql calls the first one out and closes
-- it with a deferred ALTER TABLE). They are fine in normal operation, where
-- rows are created one at a time in a workable order, but they make a bulk
-- restore impossible: there is no ordering of whole tables that satisfies a
-- cycle, so the restore transaction fails on whichever side is inserted
-- first. That is exactly how the first real restore attempt failed.
--
-- Marking only these two constraints DEFERRABLE lets the restore defer them
-- to COMMIT, by which point both sides are present. Every other constraint
-- stays IMMEDIATE, so a malformed archive is still rejected at the
-- statement that introduces the bad row rather than at the very end.
--
-- INITIALLY IMMEDIATE means normal application traffic is unaffected: the
-- constraints behave exactly as before unless a transaction explicitly asks
-- for deferral with SET CONSTRAINTS.
ALTER TABLE issues
  DROP CONSTRAINT fk_issues_exception,
  ADD CONSTRAINT fk_issues_exception
    FOREIGN KEY (exception_id) REFERENCES exceptions(id)
    DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE asset_identity_keys
  DROP CONSTRAINT asset_identity_keys_source_observation_id_fkey,
  ADD CONSTRAINT asset_identity_keys_source_observation_id_fkey
    FOREIGN KEY (source_observation_id) REFERENCES observations(id)
    DEFERRABLE INITIALLY IMMEDIATE;
