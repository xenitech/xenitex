DELETE FROM risk_scoring_policies WHERE version = 1;
ALTER TABLE risk_scoring_policies ALTER COLUMN created_by SET NOT NULL;
