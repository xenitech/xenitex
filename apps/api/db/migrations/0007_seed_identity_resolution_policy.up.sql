-- MOD-05: identity resolution needs a strict, documented precedence order
-- over identity_keys to exist at all. asset_merge_events.policy_version has
-- a NOT NULL FK to this table's version column, so without a seeded row,
-- POST /asset-merges could never succeed -- 0001_init.up.sql created the
-- table but never seeded one, same class of gap as pacing_ceilings.
--
-- created_by was NOT NULL, but migrations run before the first
-- administrator exists (setup wizard runs after), so there is no user row
-- to reference yet. Relaxed to nullable, matching pacing_ceilings.updated_by
-- and every other "system default, no particular human authored it" column.
ALTER TABLE identity_resolution_policies ALTER COLUMN created_by DROP NOT NULL;

-- Precedence: most stable/hardest-to-spoof identity signal first. A raw
-- network address is never in this list at all (MOD-05's "an address is
-- never an identity").
INSERT INTO identity_resolution_policies (id, version, precedence_order, merge_rules, is_active, created_by)
VALUES (
  gen_random_uuid(),
  1,
  ARRAY['machine_uuid', 'certificate_fingerprint', 'serial_number', 'mac_address', 'fqdn']::identity_key_type_enum[],
  '{"minimumConfidenceForAutoMerge": 0.9}'::jsonb,
  true,
  NULL
)
ON CONFLICT (version) DO NOTHING;
