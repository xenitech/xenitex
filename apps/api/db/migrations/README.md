# Migrations

Plain, reviewable `.sql` files — no ORM schema DSL. Each numbered migration has
an `.up.sql` and a matching `.down.sql`. The runner is a thin wrapper (Step 4)
around a `schema_migrations` tracking table; any of `node-pg-migrate`,
`postgres-migrations`, or a ~40-line custom runner satisfies this convention
equally well, so that choice is deliberately not locked in here.

- `0001_init.up.sql` / `0001_init.down.sql` — the schema in `docs/database-schema.md`,
  translated 1:1. See that file for the rationale behind every table; this
  migration should never drift from it without both being updated in the same PR.
- Never edit a migration that has shipped to a customer appliance. Add a new one.
- `issues.exception_id` and `exceptions.issue_id` reference each other. `issues`
  is created first with the column but no FK; the FK is added via `ALTER TABLE`
  once `exceptions` exists (see the end of `0001_init.up.sql`). This is the only
  deferred constraint in the schema — everything else is a straight-line
  dependency order.
