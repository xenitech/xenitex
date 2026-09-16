-- `GRANT ALL ON ALL TABLES IN SCHEMA public` (0001_init.up.sql) does not
-- cover sequences -- they are a distinct object class in Postgres's GRANT
-- system. Every `bigserial` column (audit_entries.id, auth_events.id)
-- backs onto one, and xenitex_app couldn't call nextval() on it, so any
-- INSERT into either table failed outright with "permission denied for
-- sequence ..." -- surfaced by the very first real write path exercised
-- against xenitex_app instead of the Postgres superuser (appendAuditEntry,
-- called from /setup/administrator).
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO xenitex_app;

-- Future migrations will add more tables; without this, every new
-- serial/bigserial column would silently reproduce the same bug the first
-- time it was actually written to under xenitex_app rather than a
-- superuser connection. `current_user` (whichever superuser this migration
-- runner connects as -- "xenitex" on a real deployment, "postgres" in the
-- disposable dev container) rather than a hardcoded name, since
-- ALTER DEFAULT PRIVILEGES only takes effect for objects the named role
-- itself later creates.
DO $$
BEGIN
  EXECUTE format(
    'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO xenitex_app',
    current_user
  );
END
$$;
