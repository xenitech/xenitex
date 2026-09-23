-- MOD-21/P2-08. An issue linked to a CVE must be able to answer "why do you
-- think this applies to this host?" in terms a reviewer can check.
--
-- Matching a banner to a CVE is inference, not proof (QA-00), and the
-- strength of that inference varies enormously: an exact version inside a
-- published affected range is a different claim from a product-name guess
-- with no version, and different again from a version carrying a
-- distribution revision that may already contain a backported fix. Storing
-- only a single confidence NUMBER loses all of that, leaving a sceptical
-- security engineer with a figure and no way to audit it.
--
-- These columns carry the matcher's own reasoning through to the issue
-- detail panel, alongside the evidence the observation already provides.
ALTER TABLE issues
  ADD COLUMN match_explanation text,
  -- Controlled vocabulary from packages/domain/src/matching/cpe.ts's
  -- MatchReason: exact_version_in_range, version_pinned_exact,
  -- vendor_revision_backport_possible, version_unparseable,
  -- range_unparseable, product_only_no_version.
  ADD COLUMN match_reasons text[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN issues.match_explanation IS
  'Plain-language statement of why this CVE was matched to this service (MOD-21). Null for findings with no CVE.';
COMMENT ON COLUMN issues.match_reasons IS
  'Machine-readable match reasons; the UI branches on these to mark a finding as a possible backport rather than a confirmed hit.';
