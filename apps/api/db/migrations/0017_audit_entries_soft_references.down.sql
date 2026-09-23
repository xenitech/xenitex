-- Re-adding these will fail if any audit entry references a session or user
-- that no longer exists, which is the state this migration exists to allow.
ALTER TABLE audit_entries
  ADD CONSTRAINT audit_entries_session_id_fkey FOREIGN KEY (session_id) REFERENCES sessions(id);
ALTER TABLE audit_entries
  ADD CONSTRAINT audit_entries_actor_user_id_fkey FOREIGN KEY (actor_user_id) REFERENCES users(id);
