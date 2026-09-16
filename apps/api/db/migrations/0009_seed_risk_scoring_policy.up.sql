-- MOD-15/MOD-18: issues.risk_score_policy_version and
-- issue_risk_score_snapshots.scoring_policy_version both need an active
-- risk_scoring_policies row to compute against. 0001_init.up.sql created the
-- table but never seeded one -- same gap class as pacing_ceilings (0006) and
-- identity_resolution_policies (0007), discovered while wiring the Step 4
-- pipeline (apps/worker) to actually score issues from real scan results.
--
-- created_by was NOT NULL, but migrations run before the first
-- administrator exists (setup wizard runs after) -- same fix as 0007.
ALTER TABLE risk_scoring_policies ALTER COLUMN created_by DROP NOT NULL;

-- Weights match packages/domain/src/scoring/risk-scoring.ts's
-- DEFAULT_RISK_SCORING_WEIGHTS exactly (docs/adr/0004-risk-scoring-function.md) --
-- keep the two in lockstep by hand until an admin changes them via the API.
INSERT INTO risk_scoring_policies (id, version, weights, is_active, created_by)
VALUES (
  gen_random_uuid(),
  1,
  '{"cvss": 0.15, "exploitProbability": 0.3, "knownExploited": 0.3, "exposure": 0.15, "criticality": 0.1, "confidence": 0}'::jsonb,
  true,
  NULL
)
ON CONFLICT (version) DO NOTHING;
