# ADR 0010: API v1 freeze and change process

- Status: Accepted at GATE 2
- Requirements: `P1-01`, `2.1`, `2.4`, GATE 2

## Context

GATE 2 requires the OpenAPI specification to be "reviewed and frozen at v1
with a written change process" before Step 3 starts building 40+ screens
against it. Step 3 and Step 4 will both be developed in parallel against
`packages/contracts/src/openapi.yaml` for weeks; without a stated rule for
what counts as a safe change, the temptation to "just tweak the response
shape" mid-build reintroduces exactly the churn GATE 2 exists to prevent.

## Decision

`packages/contracts/src/openapi.yaml` at its current state (all operations
carry an `operationId`; validated clean by `redocly lint`, zero errors) is
**v1, frozen**. Concretely:

**Additive changes — allowed on `/v1` via normal PR review, no version bump:**

- A new endpoint or operation.
- A new optional request/response field.
- A new enum value appended to an existing enum (never inserted/reordered).
- A new `code` value in a Problem Details response (ADR 0006).
- A new response header.
- Loosening a validation constraint (e.g. raising a `maxLength`).

**Breaking changes — forbidden on `/v1`; require a new `/v2` path (ADR
0006's URI versioning) and are out of scope until a version bump is
explicitly decided:**

- Removing or renaming a field, endpoint, or `code` value.
- Changing a field's type, or a required field's optionality.
- Tightening a validation constraint in a way that rejects previously-valid
  requests.
- Changing the meaning of an existing `code` value.
- Reordering or removing an enum value.

**Enforcement.** `pnpm --filter @xenitex/contracts run lint:openapi` (`redocly
lint`) must stay at zero errors; `pnpm --filter @xenitex/contracts run
verify-generated` must stay clean (ADR-implicit: the generated TypeScript
client is never hand-edited, so a spec change is only real once regenerated
and committed). Any PR touching `openapi.yaml` names which category (additive
or breaking) its change falls into in the PR description — a breaking change
without an accompanying `/v2` path is a review rejection citing this ADR, not
a style nitpick.

**Mock-server parity.** Because `apps/mock-server` (`2.4`) is built against
this same file via `openapi-backend`'s own schema validation, an additive
change that isn't also reflected in a fixture/handler degrades gracefully
(the operation still validates and routes; `notImplemented` falls back to a
schema-derived auto-mock). A breaking change, by construction, cannot be
made without also touching the mock server's handlers to keep them
compiling against the regenerated types — this is a deliberate, low-cost
tripwire, not a coincidence.

## Consequences

- Step 3 (frontend) and Step 4 (backend) can both build against `/v1`
  concurrently without one side's contract assumptions silently rotting
  under the other.
- A genuinely necessary breaking change mid-build is not blocked outright —
  it just has to be a new `/v2` operation living alongside the frozen `/v1`
  one, decided consciously rather than by drive-by edit.
- This ADR itself can be superseded (not silently reinterpreted) if the
  team decides the additive/breaking taxonomy above needs adjustment.

## Alternatives considered

- **No formal freeze — review every spec PR case-by-case.** Rejected: this
  is exactly the ambiguity GATE 2 exists to close before 40+ screens start
  depending on the contract; "case-by-case" in practice means whoever is
  fastest wins the argument.
- **Semantic-version the whole spec (v1.1, v1.2, ...) instead of an
  additive/breaking split.** Rejected as unnecessary ceremony for this
  release: ADR 0006 already fixed URI-path versioning at the `/v1` /
  `/v2` granularity, and a finer-grained semver scheme has no consumer in
  this codebase to read it.
