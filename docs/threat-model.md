# STRIDE Threat Model — Read-Only Vulnerability Management Appliance

- Status: First draft (`1.6`). Updated in the same PR as any trust-boundary
  change (`SEC-14`) — this is a living document, not a one-time exercise.
- This draft covers the architecture as scaffolded in Step 1
  (`docs/database-schema.md`, `deploy/compose/docker-compose.yml`,
  `packages/domain`). It will need a second pass once Step 4 lands the real
  adapter implementations and the vulnerability-data import pipeline, since
  those introduce trust boundaries (parsing untrusted scanner output,
  importing a signed-but-external data bundle) that don't fully exist yet.

## System overview and trust boundaries

```
[Customer's browser] --TLS--> [web (nginx, static)] --same-origin API calls--> [api (Fastify)]
                                                                                    |
                                                              [internal network, no external access]
                                                                                    |
                              +---------------------+--------------------+---------+
                              |                      |                    |
                        [postgres]              [redis/valkey]      [worker (scanner adapters)]
                                                                            |
                                                                    [scan_egress network]
                                                                            |
                                                          [customer's own network -- scan targets,
                                                           bounded by authorized_scope + exclusion_rules]

[operator, out-of-band] --signed bundle--> [offline install / air-gapped update importer]
```

Trust boundaries, numbered for cross-reference below:

- **B1** — customer browser ↔ `web`/`api` (the only boundary reachable from
  outside the appliance's own network, per `SEC-01`).
- **B2** — `api`/`worker` ↔ `postgres`/`redis` (internal Docker network,
  `internal: true`, unreachable from `edge`).
- **B3** — `worker` ↔ scan targets on the customer's network (`scan_egress`
  network; the only place this product's own traffic reaches infrastructure
  it doesn't own).
- **B4** — operator ↔ offline install bundle / air-gapped update artifact
  (the only path anything enters the appliance from outside, post-install).
- **B5** — `api` ↔ `worker` via the job queue (Redis/Valkey), carrying scan
  plans in one direction and observations/progress in the other.

## Per-boundary STRIDE analysis

### B1 — Browser ↔ web/api

| Threat                 | Scenario                                                                                                                         | Mitigation                                                                                                                                                                                                   | Requirement                |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------- |
| Spoofing               | Attacker on the customer's network impersonates a legitimate user's session                                                      | Opaque server-side sessions, `HttpOnly`/`Secure`/`SameSite=Strict` cookies, MFA mandatory for operator/administrator                                                                                         | `SEC-08`, `SEC-09`         |
| Spoofing               | Credential stuffing / brute force against login                                                                                  | Rate limiting with lockout, keyed by account and source address; breached-password check at signup                                                                                                           | `SEC-11`, `SEC-07`         |
| Tampering              | CSRF against a state-changing endpoint (e.g. triggering a scan, approving an exception)                                          | Double-submit CSRF token required on all state-changing requests                                                                                                                                             | `SEC-08`                   |
| Tampering              | XSS via a scanner-derived string (banner, cert subject) rendered unescaped in the issue detail view                              | Every such string is wrapped `Untrusted<T>` in the domain model (`packages/domain/src/primitives.ts`) and never reaches the DOM without explicit escaping; CSP forbids inline/eval script as a second layer  | `SEC-17`, `SEC-10`         |
| Repudiation            | A user denies having approved a risk-acceptance exception or triggered a scan outside a review window                            | Every mutating action is an `audit_entries` row with actor, session, source address, before/after state, hash-chained (`DATA-02`/`DATA-03`)                                                                  | `DATA-02`, `DATA-03`       |
| Information disclosure | A lower-privileged user (viewer/analyst) reads data scoped to operator/administrator                                             | Server-side authorization on every endpoint with a negative-authorization test per endpoint; UI permission checks are cosmetic only                                                                          | `SEC-13`                   |
| Information disclosure | Session token or CSRF token leaks via logs                                                                                       | Structured JSON logging (`OPS-01`) with allowlist-based redaction, never a denylist regex that misses a field                                                                                                | `SEC-05`                   |
| Denial of service      | An authenticated but malicious/compromised low-privilege account creates scans/exports rapidly to exhaust queue capacity or disk | Rate limiting on scan creation and export, keyed by account; bounded queues and per-scope concurrency caps (4.4) prevent one client from starving others                                                     | `SEC-11`, `P2-16`, `P2-17` |
| Elevation of privilege | A viewer forges a request to an administrator-only endpoint (e.g. global stop, user management) by guessing the route            | Every endpoint independently authorization-checked server-side, not inferred from which screens the client renders (`SEC-13`); a negative-authorization test exists per endpoint by the time Step 4 ships it | `SEC-13`                   |

### B2 — api/worker ↔ postgres/redis

| Threat                 | Scenario                                                                                              | Mitigation                                                                                                                                                                                                                                                                                                                                               | Requirement                             |
| ---------------------- | ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| Spoofing               | A compromised container on `edge` attempts to reach Postgres/Redis directly                           | `internal` Docker network has no route from `edge`; only `api` and `worker` are attached to both `internal` and their own network                                                                                                                                                                                                                        | `SEC-01`, `SEC-04`                      |
| Tampering              | A compromised `api` process attempts to alter or delete audit/observation history to cover its tracks | `xenitex_app` role (which `api`/`worker` connect as) has `UPDATE`/`DELETE` revoked on `observations`, `raw_artifacts`, and `audit_entries` at the database level — this is enforced by Postgres grants, not application logic, so a full RCE in the API process still cannot silently rewrite history without also compromising the database role itself | `DATA-02`, migration `0001_init.up.sql` |
| Repudiation            | Same as above, aimed at making an action undiscoverable rather than altering its record               | Audit hash chain (`entry_hash`/`prev_entry_hash`) means even a successful row-level tamper (via a different, higher-privileged role) is detectable by chain verification, which fails at the first altered or removed entry                                                                                                                              | `DATA-02`                               |
| Information disclosure | Database credentials leak via a container escape or misconfigured secret                              | Postgres/Redis credentials via Docker secrets (`docker-compose.yml`), 0600 env files, never logged or returned by an API (`SEC-05`); `worker` never holds a credential broader than what `api` has (`SEC-03`)                                                                                                                                            | `SEC-05`, `SEC-03`                      |
| Denial of service      | Postgres connection pool exhaustion from a runaway pipeline stage                                     | `OPS-02` metrics on connection pool saturation; per-scope concurrency caps bound how many pipeline jobs run concurrently                                                                                                                                                                                                                                 | `OPS-02`, `P2-17`                       |
| Elevation of privilege | `worker` process compromise used to pivot to full database access                                     | `worker` connects with the same restricted `xenitex_app` role as `api` — no separate, broader-scoped worker credential exists to escalate to                                                                                                                                                                                                             | `SEC-03`                                |

### B3 — worker ↔ scan targets (the highest-risk boundary in a read-only product)

| Threat                 | Scenario                                                                                                                                                  | Mitigation                                                                                                                                                                                                                                                                                                                                        | Requirement          |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| Spoofing               | N/A in the traditional sense — the concern here is the _appliance_ being mistaken for an attacker by the customer's own security tooling, not the reverse | Scan traffic originates only from `worker`'s `scan_egress` interface, is pacing-limited, and is tied to a `scan_run_id`/`correlation_id` an operator can produce on request if a customer's IDS flags it                                                                                                                                          | `SAFE-04`, `OPS-01`  |
| Tampering              | A scan target outside the authorized scope gets probed due to a scope-validation bug                                                                      | Enforced independently at TWO layers — scan-plan validation and again in the worker immediately before target dispatch (`SAFE-02`) — specifically so a bug in one layer doesn't silently become a scope violation; `GATE 4` requires this proven by packet capture, not just log inspection                                                       | `SAFE-01`, `SAFE-02` |
| Tampering              | A fragile device (printer, medical/industrial controller) is damaged or knocked offline by an over-intrusive scan                                         | Bundled fragile-device heuristics auto-downgrade to `passive-inventory` and flag the asset; never auto-upgraded                                                                                                                                                                                                                                   | `SAFE-05`            |
| Repudiation            | A customer disputes that a scan caused an outage and the appliance has no record of what was actually sent                                                | Every scan run's plan (target count, profile, pacing) is a `scan_plan_previews` row confirmed by a named user before execution (`SAFE-08`); `scan_run_targets` records per-target outcome                                                                                                                                                         | `SAFE-08`, `DATA-03` |
| Information disclosure | Scanner-derived data (banners, service versions) is mishandled and leaks between customers                                                                | N/A for this release — single appliance per customer, no multi-tenant data path exists in the schema (`docs/database-schema.md` explicitly has no tenant-isolation model because there's only ever one organisation per appliance)                                                                                                                | —                    |
| Denial of service      | The appliance itself becomes an unwitting DoS tool against the customer's own infrastructure via excessive scan pacing                                    | Server-side pacing ceilings (`SAFE-04`) enforced regardless of client request, with a hard system-wide maximum (`pacing_ceilings` table) that per-scope/per-profile configuration cannot exceed                                                                                                                                                   | `SAFE-04`            |
| Denial of service      | A scan runs during a customer-declared maintenance/blackout window and degrades a live service                                                            | Blackout windows (`SAFE-06`), global and per-scope; a running scan pauses cleanly between hosts and resumes after                                                                                                                                                                                                                                 | `SAFE-06`            |
| Elevation of privilege | An authenticated user attempts to repurpose the appliance as a general attack tool (e.g. requesting exploitation checks beyond safe detection)            | `ANTI-04`: no exploitation, no payload delivery beyond safe detection checks, no credential guessing — enforced by the adapter boundary only ever exposing `passive-inventory`/`safe`/`standard` profiles, none of which include exploitation; this is a Step 5.6 adversarial-review target, not yet proven against a real adapter implementation | `ANTI-04`, `5.6`     |

### B4 — Offline install bundle / air-gapped update

| Threat                 | Scenario                                                                                       | Mitigation                                                                                                                                                                                    | Requirement                       |
| ---------------------- | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| Spoofing               | A malicious actor substitutes a tampered install/update bundle                                 | Release artifacts are signed; the importer refuses unsigned or mismatched bundles                                                                                                             | `SEC-16`                          |
| Tampering              | A legitimate bundle is modified in transit (e.g. on removable media used to cross the air gap) | Signature verification happens before any content is trusted, including a pre-import manifest diff for updates (`5.2`)                                                                        | `SEC-16`                          |
| Information disclosure | N/A — the bundle contains no customer data (it flows in, not out)                              | —                                                                                                                                                                                             | `DATA-07`                         |
| Denial of service      | A corrupted or mismatched bundle partially applies, leaving the appliance in a broken state    | Atomic apply: vulnerability-data import is all-or-nothing (`P2-06`); update process includes pre-import verification and a documented maintenance window, not a claimed zero-downtime upgrade | `P2-06`, `5.2`                    |
| Elevation of privilege | A bundle is crafted to exploit the importer itself (e.g. path traversal in a tarball)          | Not yet designed — flagged as a Step 5.1 implementation concern this threat model will need a second pass on once the importer exists                                                         | `SEC-16` (implementation pending) |

### B5 — api ↔ worker via job queue

| Threat            | Scenario                                                                      | Mitigation                                                                                                                                                                                                                                                                             | Requirement                |
| ----------------- | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| Tampering         | A malformed or hostile job payload crashes or exploits the worker             | Schema validation at every boundary (`SEC-12`), applied to queue payloads exactly as to HTTP requests, not just at the API edge                                                                                                                                                        | `SEC-12`                   |
| Denial of service | Queue flooding by a compromised `api` process or a bug in scan-creation logic | Bounded queues, per-scope concurrency caps (`P2-16`/`P2-17`); `OPS-02` queue-depth/age metrics make this observable before it becomes an outage                                                                                                                                        | `P2-16`, `P2-17`, `OPS-02` |
| Repudiation       | A scan result is disputed as never having actually run                        | `scan_run_targets`/`observations` are the durable record independent of the queue itself — the queue is transport, not the system of record (`4.4`: "all pipeline state lives in the queue and database, never only in memory," meaning the database, not the queue, is authoritative) | `P2-14`                    |

## Known gaps in this draft

- **Adapter-specific threats** (e.g. a hostile scan target sending a
  malformed response designed to exploit the parser) are only generically
  covered here (`SEC-12`/`SEC-17`) — a proper pass needs the actual adapter
  implementations from Step 4 and the golden-file hostile-input corpus
  (`QA-02`) to be concrete rather than aspirational.
- **The offline-bundle importer's own attack surface** (B4's elevation-of-privilege
  row) is explicitly marked pending — nothing has been designed yet, and
  this document will be wrong to claim otherwise before Step 5.1.
- **Multi-user concurrent-edit races** (two analysts triaging the same issue)
  are addressed at the API-contract level (`docs/adr/0006-api-conventions.md`'s
  `ETag`/`If-Match` requirement) but aren't yet reflected as a distinct
  threat-model row — added here as a note rather than a full row because the
  mitigation is a contract decision, not yet an implemented control to
  verify against.
