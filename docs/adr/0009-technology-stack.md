# ADR 0009: Technology stack for apps/api, apps/worker, and the monorepo

- Status: Accepted — confirmed with the team lead before any Step 1 scaffolding
  was written, per `WORK-01` ("get assumptions confirmed before writing code").
- Requirements: `SCOPE-02` (scanner adapter boundary and domain model must
  survive whichever stack is chosen), `P1-02` (generated, not hand-written,
  API types)

## Context

The master prompt fixes the domain model and the API-contract discipline
(OpenAPI-first, generated TypeScript client, `packages/domain` holding
shared types) but does not name a language or framework. That choice is
expensive to reverse once four apps and a handful of packages are scaffolded
against it, so it was resolved explicitly before any code was written rather
than defaulted silently.

## Decision

**TypeScript end-to-end** (`apps/web`, `apps/api`, `apps/worker`,
`packages/domain`, `packages/contracts`, `packages/scanner-adapters`), on
Node.js 20. Rejected alternative: a polyglot split (TypeScript frontend,
Go/Python backend) — a single language means the fingerprint algorithm
(ADR 0002), the risk-scoring function (ADR 0004), and the identity-resolution
policy (ADR 0003) are implemented exactly once and imported everywhere they
run, rather than needing a second implementation (or a codegen step) to keep
a Go/Python backend in sync with the TypeScript domain package. For a 4–5
person team, one runtime to operate, debug, and hire against also matters
more than per-service language optimality would for a larger org.

**pnpm workspaces + Turborepo** for the monorepo. Rejected: npm workspaces
alone (weaker caching, no build-graph orchestration at this repo's size) and
Nx (more machinery and a steeper learning curve than this team's size
justifies). pnpm's strict, non-hoisted `node_modules` also acts as an
incidental backstop for `PRIN-03`: a package can't accidentally get away
with using a transitive dependency it never declared, which keeps the
dependency tree — and therefore the SBOM — honest about what each package
actually depends on.

**Fastify + Zod, schema-first**, for `apps/api`. Rejected: NestJS — its
decorator-based, code-first style fights the OpenAPI-spec-first workflow
Step 2 establishes (`2.1`: the spec is authored first and is the single
source of truth; a code-first framework tends to let the two drift apart
unless the team is very disciplined about regenerating the spec from code,
which inverts the stated source of truth). Fastify's schema validation
maps directly onto OpenAPI 3.1 request/response schemas and gives `SEC-12`
("reject unknown fields") for free via `additionalProperties: false`.

**Migrations as plain reviewable `.sql` files, no ORM**, with **Kysely** as a
type-safe query builder in application code (not an ORM — no active-record
pattern, no hidden N+1 query generation). Rejected: Prisma/Drizzle-style
schema DSLs that generate SQL from a separate schema language. In a
security product where `SEC-12` ("no string-concatenated SQL") and the
append-only/immutability guarantees in `docs/adr/0007-schema-conventions.md`
matter, SQL that's directly reviewable and diffable in a PR beats SQL
generated from an intermediate representation. The exact migration _runner_
(node-pg-migrate vs. a small custom runner) is left open in
`apps/api/db/migrations/README.md` — that choice doesn't affect the SQL
itself and doesn't need to be locked in at Step 1.

## Consequences

- `packages/domain` has zero runtime dependencies (verified: it type-checks
  and its tests pass with only `typescript`/`tsx` as dev tooling) — this is
  what makes it genuinely shared between `apps/api`, `apps/worker`, and (via
  types only, never logic) `apps/web`.
- Every package in the monorepo was verified end-to-end during Step 1: `pnpm install`
  resolves the full graph, every package type-checks, lints clean, and its
  tests pass (including a real up → down → up migration cycle against
  Postgres 16 in Docker) — this ADR reflects a stack that was actually
  exercised, not just decided on paper.
- Node 20 is the deployment target (`.nvmrc`, `engines` in the root
  `package.json`); the sandbox this repo was scaffolded in only had Node 18
  available, which is noted in `.github/workflows/ci.yml` so a future reader
  isn't confused about why some verification commands in the Step 1 record
  ran tools directly rather than through `pnpm`/`turbo`.

## Alternatives considered

See inline rejections above. No alternative was prototyped past the
decision point — the team's own experience and the structural fit with
`SCOPE-02`/`P1-02` were judged sufficient without a bake-off, given the
14-week schedule.
