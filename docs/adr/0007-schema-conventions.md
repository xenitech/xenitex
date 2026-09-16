# ADR 0007: Database schema conventions

- Status: Accepted at GATE 1
- Requirements: `DATA-02`, `DATA-06`, `SEC-17`, general schema hygiene

## Context

`docs/database-schema.md` §1 states these conventions and applies them across
every table in `apps/api/db/migrations/0001_init.up.sql`. This ADR is that
section lifted into `docs/adr/` per that document's own note ("should be
lifted into `docs/adr/0007-schema-conventions.md` verbatim per `1.4`"), so
the conventions are reviewable and citable as a decision record independent
of the schema document itself, which will keep growing with new migrations.

## Decision

- **Primary keys:** UUIDv7, generated in the application layer, not
  `gen_random_uuid()` — time-sortable, so identifiers are k-sortable and
  creation order is inferable without a separate `created_at` scan.
  Exception: `audit_entries`, which uses `BIGSERIAL` because the hash chain
  (`DATA-02`) requires strict monotonic ordering guaranteed by the database
  sequence, not a client clock that could be skewed or replayed.
- **Timestamps:** every timestamp column is `timestamptz`, written in UTC
  (`DATA-06`). Display-timezone conversion happens at the API/UI boundary
  using `organization_settings.timezone`. No `timestamp without time zone`
  column is permitted anywhere — enforced by a CI lint over
  `information_schema.columns` (to be added alongside the first migration
  that would violate it, per `QA-07`'s "no unaddressed TODOs" — this is
  tracked as Step 4 work, not left as a standing gap).
- **Naming:** tables plural snake_case; columns snake_case; foreign keys
  `<referenced_singular>_id`; enum type names `<concept>_enum`, values
  snake_case.
- **Soft delete vs. lifecycle state:** no generic `deleted_at` column
  anywhere. Entities that can be retired carry an explicit lifecycle/state
  enum (`assets.lifecycle_state`, `issues.state`, `authorized_scopes` via
  `superseded_by_id`) because "deleted" is never an honest description of
  what happened to a security record.
- **Immutability:** `observations`, `raw_artifacts`, and `audit_entries` are
  append-only, enforced by `REVOKE UPDATE, DELETE` from the `xenitex_app`
  role and a separate `xenitex_retention_worker` role holding the only
  `DELETE` grant, scoped further by the retention policy in application
  code. See the role setup at the bottom of `0001_init.up.sql`.
- **JSONB usage:** only where the shape is genuinely variable or
  evidence-sourced (adapter-extracted attributes, evidence payloads,
  risk-factor breakdowns, pacing config), validated at the API boundary
  (`SEC-12`), never trusted from the column alone, never used as an escape
  hatch for relational data with a stable shape.
- **Untrusted strings:** per `SEC-17`, any column holding a value that
  originated from a scanned target is suffixed `_untrusted` or lives inside
  an `evidence`/`untrusted_evidence` JSONB blob — never a bare `text` column
  indistinguishable from first-party data. This is a naming convention
  specifically so it's greppable: a CI check (Step 4) can assert every
  `_untrusted` column and every `untrusted_evidence` read site passes
  through an output-escaping function before rendering.
- **Foreign keys:** default `ON DELETE RESTRICT`; `ON DELETE CASCADE` only
  for true ownership join rows (`issue_observations`, `asset_group_members`)
  where the child row has no independent meaning.
- **Partitioning readiness, not partitioning:** no table is partitioned at
  `PERF-01` volumes. `observations` and `audit_entries` are the two most
  likely candidates for range partitioning by month at `v2.0` scale; their
  primary keys already include a natural partition key so adding
  partitioning later is a storage-layer change, not a schema rewrite.

## Consequences

- Every future migration is reviewed against this list, not just against
  "does it work" — a migration that adds a bare `text` column for
  scanner-derived data, or a naive `deleted_at`, is a review rejection
  citing this ADR, not a style nitpick.
- The append-only enforcement (role-based `REVOKE`) was validated by
  actually running `0001_init.up.sql` and `.down.sql` against a real
  Postgres 16 instance during Step 1, including a full up → down → up
  cycle — this is not a paper design, the roles and grants exist and were
  exercised.

## Alternatives considered

- **ORM-managed schema (Prisma/Drizzle) instead of hand-written SQL
  migrations.** Rejected — see `docs/adr/0009-migration-tooling.md` (or
  wherever the stack-selection ADR lands) for the fuller reasoning; in
  short, a security product benefits from SQL that's directly reviewable
  and diffable, not generated from a separate DSL.
