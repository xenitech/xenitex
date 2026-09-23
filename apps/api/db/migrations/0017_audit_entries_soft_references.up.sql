-- DATA-02/DATA-03. `audit_entries` carried hard foreign keys to `sessions`
-- and `users`. For an APPEND-ONLY log that is the wrong relationship, and
-- it broke three separate things in practice:
--
--  1. Restore (DATA-05). `sessions` is deliberately excluded from backups —
--     restoring live authentication state would resurrect logins that were
--     revoked after the backup was taken, including an attacker's. But the
--     FK meant audit entries could not be restored without the sessions
--     they referenced, so the restore failed partway and rolled back.
--
--  2. Retiring an account. Deactivating a user is the product's own
--     offboarding path, but deleting one was impossible while any audit
--     entry named them — so test and departed accounts accumulated forever.
--
--  3. Session retention. Old session rows could never be purged, because
--     the audit log pinned them indefinitely.
--
-- DATA-03 requires an audit entry to RECORD the actor and session. It
-- records their identifiers, which is a historical fact that stays true
-- after the session expires and the account is removed. A referential
-- constraint asserts something stronger and different: that the row still
-- exists. Dropping these keeps the recorded value and stops the log
-- dictating the lifecycle of everything it has ever mentioned.
--
-- The hash chain is unaffected: it covers the canonical payload, which
-- already carries these identifiers as values.
ALTER TABLE audit_entries DROP CONSTRAINT IF EXISTS audit_entries_session_id_fkey;
ALTER TABLE audit_entries DROP CONSTRAINT IF EXISTS audit_entries_actor_user_id_fkey;

COMMENT ON COLUMN audit_entries.session_id IS
  'The session that performed the action, recorded as a value (DATA-03). Deliberately not a foreign key: the session may since have been revoked and purged, and the audit record must outlive it.';
COMMENT ON COLUMN audit_entries.actor_user_id IS
  'The actor who performed the action, recorded as a value (DATA-03). Deliberately not a foreign key: the account may since have been removed, and the audit record must outlive it.';
