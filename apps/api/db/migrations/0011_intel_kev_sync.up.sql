-- docs/cve-intel-feature-spec.md FEED-08.2/FEED-25/FEED-27: the first real
-- IntelProvider source (CISA KEV — no auth, no pagination, a single JSON
-- fetch) reuses vulnerability_data_imports as the corpus-version record
-- (its supersededById-equivalent, superseded_by_id, already gives us
-- FEED-27's rollback chain for free) rather than inventing a parallel
-- "sync run" table.
--
-- bundle_signature was NOT NULL because the only import path when
-- 0001_init.up.sql was written was the signed offline bundle (SEC-16). An
-- online sync fetches directly over TLS and produces no signature to
-- verify -- relaxed to nullable, and content_sha256 added so an online
-- import still has a way to prove exactly which bytes produced it (DATA-01
-- rationale, applied to intelligence data instead of scan artifacts).
ALTER TABLE vulnerability_data_imports ALTER COLUMN bundle_signature DROP NOT NULL;
ALTER TABLE vulnerability_data_imports ADD COLUMN content_sha256 text;
ALTER TABLE vulnerability_data_imports ADD COLUMN failure_reason text;

-- MATCH-15: "A v2 base score of 10.0 and a v3.1 base score of 10.0 are not
-- the same statement and must not be presented identically" -- the existing
-- cvss_base_score/cvss_vector columns hold whichever version MATCH-17's
-- precedence (v4.0 > v3.1 > v3.0 > v2) picked; this records which one, so
-- the UI is never guessing. Storing every version side by side (MATCH-14
-- in full) needs a child table and is deferred -- see docs/cve-intel-feature-spec.md.
ALTER TABLE vulnerabilities ADD COLUMN cvss_version text;

-- FEED-23: "a global switch disables all online update capability
-- permanently for a deployment, with a visible state on the Intelligence
-- screen." Singleton row, same pattern as pacing_ceilings/organization_settings.
CREATE TABLE intel_settings (
  id                          smallint PRIMARY KEY DEFAULT 1,
  online_updates_disabled     boolean NOT NULL DEFAULT false,
  updated_at                  timestamptz NOT NULL DEFAULT now(),
  updated_by                  uuid REFERENCES users(id),
  CONSTRAINT intel_settings_singleton CHECK (id = 1)
);
INSERT INTO intel_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
