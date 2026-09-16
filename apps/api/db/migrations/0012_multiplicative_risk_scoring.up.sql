-- docs/issues-scoring-dashboard-spec.md SCORE-* supersedes ADR-0004's
-- weighted-sum function with a multiplicative one (see that ADR's "Update"
-- section) and adds a fourth exposure tier ("isolated segment") this
-- domain didn't have yet.
--
-- Postgres allows ALTER TYPE ... ADD VALUE inside a transaction as long as
-- the new value isn't used by a statement in the same transaction (true
-- since PG12; we're on 16) -- nothing below inserts an 'isolated' row, so
-- this is safe here.
ALTER TYPE exposure_classification_enum ADD VALUE 'isolated';

-- SCORE 2.4/SCORE-08: the asset rating is a first-class, displayed number
-- with its band. No separate versioned profile-history table yet (that's
-- PROF-01's full scope, still deferred) -- these two columns hold the
-- current value only, recomputed by apps/worker whenever an issue affecting
-- the asset is created or updated.
ALTER TABLE assets ADD COLUMN risk_rating numeric(5,2);
ALTER TABLE assets ADD COLUMN risk_band text;

-- MOD-18: a weight change is a NEW policy version, never an edit to an
-- existing one -- version 1's row (ADR-0004's weighted-sum weights) stays
-- exactly as it was so every issue scored under it keeps a faithfully
-- replayable issue_risk_score_snapshots row. Version 2 holds the new
-- multiplicative weights and becomes the only active policy.
UPDATE risk_scoring_policies SET is_active = false WHERE version = 1;
INSERT INTO risk_scoring_policies (id, version, weights, is_active, created_by)
VALUES (
  gen_random_uuid(),
  2,
  '{
    "knownExploitedMultiplier": 1.5,
    "exploitProbabilityBaseMultiplier": 1.0,
    "exploitProbabilityScale": 0.5,
    "exposure": {"external": 1.3, "dmz": 1.15, "internal": 1.0, "isolated": 0.8, "unknown": 1.0},
    "criticality": {"critical": 1.25, "high": 1.10, "medium": 1.0, "low": 0.85},
    "confidence": {"verified": 1.0, "corroborated": 0.9, "inferred": 0.75}
  }'::jsonb,
  true,
  NULL
)
ON CONFLICT (version) DO NOTHING;
