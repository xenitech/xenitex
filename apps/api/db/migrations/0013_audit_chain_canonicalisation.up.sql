-- DATA-02. The audit hash chain was computed over `JSON.stringify(...)` of a
-- JavaScript object, which serialises keys in INSERTION order. Verification
-- reads the same values back out of `jsonb` columns, and Postgres `jsonb`
-- normalises key order (by key length, then bytewise) rather than preserving
-- insertion order. Any entry whose before_state/after_state carried two or
-- more keys therefore hashed differently on write than on read, and the
-- chain verifier reported it as TAMPERED.
--
-- That is not a cosmetic defect: it is a tamper-evidence control producing
-- false positives, which makes it useless precisely when it matters — an
-- operator investigating a suspected compromise cannot tell a real
-- alteration from this noise (see docs/runbooks/appliance-suspected-
-- compromised.md, which instructs them to trust this indicator).
--
-- Entries written before this migration hashed over an ordering that cannot
-- be reconstructed once the value has round-tripped through jsonb, so they
-- are not retroactively verifiable. They are marked chain_version = 1 and
-- reported by the verifier as explicitly unverifiable-legacy rather than
-- being silently passed or silently failed. New entries use chain_version 2,
-- which canonicalises with recursively sorted keys and so is stable across
-- the jsonb round trip.
ALTER TABLE audit_entries
  ADD COLUMN chain_version smallint NOT NULL DEFAULT 1;

-- Existing rows keep version 1 (the default above). Everything appended from
-- now on is written as version 2 by packages/db/src/audit-log.ts.
ALTER TABLE audit_entries
  ALTER COLUMN chain_version SET DEFAULT 2;

COMMENT ON COLUMN audit_entries.chain_version IS
  'Canonicalisation rule used to compute entry_hash. 1 = insertion-order JSON (not verifiable after a jsonb round trip; see migration 0013). 2 = recursively key-sorted JSON.';
