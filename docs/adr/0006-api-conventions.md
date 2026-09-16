# ADR 0006: API pagination and error-format conventions

- Status: Accepted at GATE 1. Actual implementation and the OpenAPI 3.1
  specification land in Step 2 (`P1-01`) — this ADR exists ahead of that
  spec precisely so Step 2 is transcribing an agreed decision into OpenAPI
  rather than making the decision while also writing 40+ endpoint
  definitions.
- Requirements: `P1-01`, `P1-04`, `P1-05`

## Context

Every one of these conventions is far more expensive to change once dozens
of endpoints exist than to fix now: pagination style affects every list
endpoint's response shape and every client's iteration logic; error format
affects every error path in every handler; idempotency and versioning
affect the request/response contract client code is written against. `1.4`
lists this explicitly among the six ADRs required before Step 2 starts.

## Decision

**Pagination: opaque cursor, not offset.** Every collection endpoint accepts
`?cursor=<opaque>&limit=<n>` and returns `{ items, nextCursor: string | null }`.
No `?page=`/`?offset=` parameter exists anywhere. Offset pagination silently
skips or duplicates rows when the underlying set mutates between pages —
intolerable on an issues list that's actively being triaged by more than one
analyst. The cursor encodes `(sortKey, id)` from the last row of the previous
page, base64-encoded and opaque to the client; it is never a raw offset
integer, so it stays correct under concurrent inserts/updates.

**Errors: RFC 9457 Problem Details, always.** Every non-2xx response is
`application/problem+json` with `type`, `title`, `status`, `detail`, and a
product-specific `code` field — the `code` is the stable, machine-readable
identifier a client (or an automated test in `QA-01`'s contract-test suite)
actually branches on; `title`/`detail` are for humans and may be reworded
without breaking anything. `code` values are namespaced by domain area (e.g.
`scope.exclusion_violation`, `auth.mfa_required`, `scan.pacing_ceiling_exceeded`)
and are part of the frozen contract per Step 2's GATE 2 — adding a new code
is additive; renaming or removing one is a breaking change requiring the
same review as any other contract change.

**Idempotency keys on every creation endpoint.** `POST` endpoints that
create a resource (scan runs, scopes, exceptions, reports) require an
`Idempotency-Key` header; a retried request with the same key against the
same endpoint returns the original response rather than creating a second
resource. This matters specifically for `SAFE-08`'s pre-flight-confirm flow
and scan creation — a client retrying a timed-out "create scan" request must
never risk starting two scans against the same scope.

**`ETag`/`If-Match` on every mutable resource.** Any `PATCH`/`PUT` against an
Issue, Exception, Scope, etc. requires `If-Match` with the resource's current
`ETag`; a stale `ETag` returns `409 Conflict` (as a Problem Details body with
`code: concurrency.stale_resource`) rather than silently overwriting a
concurrent edit. This is the concrete mechanism behind "two analysts
triaging the same issue list" not corrupting each other's lifecycle
transitions.

**URI path versioning: `/v1/...`.** Not header-based or content-negotiated
versioning — a version in the path is visible in every log line (`OPS-01`),
every browser network tab during support, and every runbook example, which
matters more for an on-premise appliance an operator debugs directly than
API elegance does.

**Long-running operations return a job resource, always polled.** No
request ever blocks on a scan (per 4.4's `SAFE-08` preview and `4.1`'s
adapter `execute()` being inherently long-running). `POST /v1/scans` returns
`202 Accepted` with a `Location` header pointing at `/v1/scan-runs/{id}`;
the client polls that resource for `status`. The same pattern applies to
report generation (4.8) and vulnerability-data bundle import (4.3/5.2).
There is no WebSocket/SSE requirement in this release — Step 3's live scan
progress view (`P1-10`) polls, which is simpler to secure (`SEC-13`'s
per-endpoint authorization check applies uniformly to a poll, not to a
persistent connection) and simpler to reproduce in the mock server (`2.4`).

## Consequences

- The mock server (`2.4`) must implement cursor pagination and Problem
  Details error shapes faithfully from the start, including the
  `PERF-01`-sized fixture, or Step 3's virtualised-list work (`P1-22`) is
  being validated against a shape production will never actually produce.
- Contract tests (`QA-01`) assert against `code` values, not `title`/`detail`
  text — this needs to be stated explicitly in the Step 2 spec review so
  nobody writes a test that breaks the next time a message is reworded for
  clarity.
- Idempotency-key storage (dedup window, expiry) is a small but real piece
  of state the API needs (likely Redis-backed, short TTL) — flagged here so
  it isn't a surprise when Step 4 wires up the real backend.

## Alternatives considered

- **Offset pagination for simplicity.** Rejected per the concurrent-mutation
  argument above; the appliance's core screen (issues list, `P1-11`) is
  exactly the case where this bites hardest.
- **Header-based API versioning (`Accept: application/vnd.xenitex.v1+json`).**
  Rejected for the on-premise debuggability reason above — an operator
  reading `deploy/compose` logs or a support engineer reading a HAR file
  should see the version without inspecting headers.
- **Webhooks/SSE for scan progress instead of polling.** Rejected for this
  release: adds a persistent-connection security surface (`SEC-13`
  authorization has to be re-checked on every message, not just on connect)
  and a mock-server fidelity problem (`2.4`) for marginal UX benefit over a
  short poll interval. Revisit only if pilot feedback (`6.2`) says polling
  latency is a real complaint.
