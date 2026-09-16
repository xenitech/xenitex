DELETE FROM risk_scoring_policies WHERE version = 2;
UPDATE risk_scoring_policies SET is_active = true WHERE version = 1;

ALTER TABLE assets DROP COLUMN IF EXISTS risk_band;
ALTER TABLE assets DROP COLUMN IF EXISTS risk_rating;

-- Postgres has no ALTER TYPE ... DROP VALUE -- recreate the enum without
-- 'isolated' the standard way. Guarded: refuses to run (leaving 'isolated'
-- in place) rather than silently corrupting data if any asset actually
-- uses it, since this down migration cannot know what the caller intends
-- for those rows.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM assets WHERE exposure_classification = 'isolated') THEN
    RAISE EXCEPTION 'Cannot roll back: assets exist with exposure_classification = isolated';
  END IF;
END $$;

ALTER TYPE exposure_classification_enum RENAME TO exposure_classification_enum_old;
CREATE TYPE exposure_classification_enum AS ENUM ('internal', 'dmz', 'external', 'unknown');
ALTER TABLE assets
  ALTER COLUMN exposure_classification DROP DEFAULT,
  ALTER COLUMN exposure_classification TYPE exposure_classification_enum
    USING exposure_classification::text::exposure_classification_enum,
  ALTER COLUMN exposure_classification SET DEFAULT 'unknown';
DROP TYPE exposure_classification_enum_old;
