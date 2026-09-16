# Xenitex — Read-Only Vulnerability Management Appliance

On-premise, single-VPS, no cloud, no AI, no remediation execution. See the
master build prompt for the full specification; this README covers what
exists in the repository right now (Steps 1–3) and how to work with it.

## Status: Step 1 (Foundations)

- [x] `1.1` Repository skeleton
- [x] `1.2` CI (lint, typecheck, unit tests, dependency scan, SBOM, `PRIN-03` assertion)
- [x] `1.3` Domain model as types (`packages/domain`) and first migration (`apps/api/db/migrations/0001_init.{up,down}.sql`)
- [x] `1.4` ADRs — see `docs/adr/`
- [x] `1.5` Licence review — `docs/licence-review.md`
- [x] `1.6` First threat-model draft — `docs/threat-model.md`
- [x] **GATE 1** — signed off. Open questions resolved: Exception stays a
      supporting object of Issue (ADR 0001); unresolved-identity observations
      get a provisional address-keyed asset (ADR 0002); `fqdn` stays at lowest
      identity precedence (ADR 0003); the risk-scoring confidence-multiplier
      floor is 0.4 (ADR 0004), and `computeRiskScore` is now implemented
      against it (`packages/domain/src/scoring/risk-scoring.ts`).

## Status: Step 2 (API contract)

- [x] `2.1` OpenAPI 3.1 specification — `packages/contracts/src/openapi.yaml`.
      ~120 operations across ~30 resource groups (every Part C entity, every
      B.1 safety-config resource, every Step 3 screen's data needs). Valid
      per `redocly lint` (0 errors); conventions from ADR 0006 (cursor
      pagination, RFC 9457 Problem Details, `Idempotency-Key`, `ETag`/`If-Match`,
      `/v1` path versioning, `202`+`Location` for long-running ops) applied
      throughout. JSON casing is camelCase; any scanner-derived field carries
      an `Untrusted` suffix (SEC-17/AIP-02), extending ADR 0007's DB-column
      convention to the API boundary.
- [x] `2.2` Generated TypeScript client — `openapi-typescript` generates
      `packages/contracts/src/generated/types.ts` from the spec (never
      hand-written, `P1-02`); `openapi-fetch` provides the typed client via
      `createXenitexClient`. `scripts/verify-generated.mjs` fails CI on drift
      between the spec and the committed generated file.
- [x] `2.3` Conventions — fixed in ADR 0006, applied throughout `2.1`.
- [x] `2.4` Mock server — `apps/mock-server` (Fastify + `openapi-backend`,
      routing/validating/mocking directly against `openapi.yaml`). Fixture
      generator (`apps/mock-server/src/fixtures/`) produces the exact
      `PERF-01` volumes (5,000 assets / 50,000 issues / 250,000
      observations — asserted by test), reusing `packages/domain`'s
      `computeRiskScore`/`computeFingerprint` so mock data is scored and
      fingerprinted identically to how the real pipeline will. Simulated
      latency (`X-Mock-Latency`), deterministic and probabilistic partial
      failure (`X-Mock-Force-Status` / `X-Mock-Fail-Rate`), role-based
      permission denial (`X-Mock-Role`, mock approximation of `P1-23`), and
      schema-validated `400`/`422` errors are all live and covered by
      contract tests (`apps/mock-server/src/server.test.ts`, 16 passing).
- [x] **GATE 2** — spec frozen at v1 with a written change process
      (`docs/adr/0010-api-v1-change-process.md`); mock server serves every
      endpoint including the `PERF-01` fixture, verified by booting it at
      full scale and paging through the entire issues collection.

## Status: Step 3 (Web panel against mocks)

All ten screens are built and wired end-to-end against `apps/mock-server`
(no backend exists yet — that's Step 4). Verified in this session by
booting the real mock server and driving a headless browser through every
flow below, not just by typechecking.

- [x] `3.1` First-run setup wizard — `apps/web/src/setup/`. Administrator →
      organisation/timezone → TLS choice → initial scope (SAFE-01 attestation
      flow) → safety-defaults review/acknowledgement → complete. Driven
      entirely off `GET /setup/status`, so a mid-wizard refresh resumes at
      the first incomplete step rather than losing progress. Boot the mock
      server with `MOCK_SERVER_SETUP_INCOMPLETE=true` to see it (see below).
- [x] `3.2` Authentication — `apps/web/src/auth/`. Sign-in → MFA challenge
      (TOTP or recovery code) → forced password change (P1-07, an
      administrator-provisioned account must set its own password before
      anything else is reachable) → mandatory TOTP enrolment for
      operator/administrator roles lacking it (SEC-09) → the app. Each gate
      is a hard stop implemented in `AuthGate.tsx`.
- [x] `3.3` Issues — `apps/web/src/issues/`. The flagship screen
      (`docs/design/wireframe-issues.md`), built to match: virtualised
      list-detail split (`@tanstack/react-virtual`), faceted state/confidence
      filters, two-stage keyboard nav (`j`/`k` moves a focus cursor, `Enter`
      commits the fetch — so fast scrolling doesn't fire a query per row),
      risk explainer expanded inline (MOD-17), full evidence per observation
      with a raw-artifact link (MOD-21), and state-aware lifecycle actions.
      "Risk accept" opens the exception-request flow (MOD-12) rather than a
      raw transition, since accepting risk requires an approver distinct
      from the requester; "Verify fix" requests a verification scan
      (MOD-13) rather than setting `verified_resolved` directly, which only
      the system may do.
- [x] `3.4` Assets — `apps/web/src/assets/`. Virtualised list-detail with
      identity keys, address/hostname history, services, tags, fragile-device
      notice, and per-asset issues/scan-history tabs.
- [x] `3.5` Scans — `apps/web/src/scans/`. History table; new-scan wizard
      (scope → profile with typed `CONFIRM` for `standard` intrusiveness →
      run-now-or-schedule → review); the review step matches
      `docs/design/wireframe-scan-review.md` — `Start scan` stays disabled
      until target count, packet volume, duration, exclusions (with the
      exclusion rule's reason, not just its ID), fragile downgrades, and
      pacing-vs-ceiling are all real, fetched numbers, never a spinner
      standing in for them. Live run view polls while queued/running/paused,
      with pause/resume/abort and raw-artifact download links.
- [x] `3.6` Scope & exclusions — `apps/web/src/scope/`. Tabs for authorised
      scopes (same attestation flow as setup), exclusion rules, scan
      profiles, blackout windows, and a read-only schedules register
      (schedules are created inline in the scan wizard, per 3.5).
- [x] `3.7` Exceptions — `apps/web/src/exceptions/`. Register with
      status filter (URL-synced), expiry countdown, and approve/reject/revoke
      actions gated on `exceptions.approve`; each row deep-links to its
      issue in the Issues screen.
- [x] `3.8` Dashboard — `apps/web/src/dashboard/`. Built last, per the
      master prompt, once the screens it links into existed. Six tiles
      (`docs/design/wireframe-dashboard.md`): risk posture with an inline
      SVG trend sparkline (no charting library), top issues by risk, SLA
      compliance (leads with overdue, not the on-time count), coverage,
      active/recent scans, and exceptions approaching expiry — every tile
      links to a pre-filtered view. Single-CTA empty state before any scan
      has run, not six zeroed tiles.
- [x] `3.9` Reports — `apps/web/src/reports/`. Template selection
      (executive summary / technical detail / delta), generate, status
      polling while pending, download links once completed.
- [x] `3.10` Administration — `apps/web/src/admin/`. Users (four fixed
      roles), notification channels, retention (enforces `minimumFloorDays`
      client-side, matching `DATA-04`), backup records + on-demand trigger,
      feature flags (surfaces the `422` when an administrator tries to
      enable a hard-off flag, e.g. `EXT-09`'s remediation executor), audit
      log with a chain-verification indicator (`DATA-02`), and system health
      (component status, vulnerability-data age, disk headroom, queue
      backlog, last backup, plus the global-stop invocation history).
      Administrator-only; every other role sees `PermissionDenied`.
      Global stop itself (`SAFE-07`) is a top-bar control in `AppShell`,
      reachable from every screen, not just this one.

Cross-cutting (P1-20 through P1-26), verified against real Persian text and
a real theme switch, not just CSS mirroring:

- [x] i18n from English and Persian resource files
      (`apps/web/src/i18n/locales/`), typed so a missing Persian key is a
      compile error (`fa.ts`'s `TranslationSchema` type), with full RTL
      (`dir`/`lang` synced to `<html>`, tables and the entire layout mirror).
      Storybook's direction toggle now also switches the active language,
      not just CSS direction.
- [x] Light/dark theme (`ThemeContext`), density, and language are
      persisted UI preferences in `localStorage` only — never tokens or
      finding data (`P1-24`).
- [x] Virtualised rendering (`@tanstack/react-virtual`) on Issues and
      Assets; manually verified against the real `perf01` fixture (5,000
      assets / ~40,000 open issues) — DOM stays at ~16–25 rows regardless of
      list size, first paint ~300ms.
- [x] Permission-aware rendering from the `/auth/session` capability
      payload (`useSession().hasCapability`) — cosmetic only; every mutation
      still assumes the server is the real enforcement (`SEC-13`, not yet
      implemented since there is no real backend until Step 4).
- [x] Every filter, sort, and selection lives in the URL
      (`useSearchParams`) on Issues, Assets, and Exceptions — shareable,
      survives a refresh, and is how dashboard tiles deep-link into
      pre-filtered views.
- [x] Bundle budget enforced in CI —
      `apps/web/scripts/check-bundle-budget.mjs`, wired into `pnpm build`.
      Current: ~151 KB JS / ~20 KB CSS gzipped against a 260/30 KB budget.
      No CDN, no external fonts (self-hosted via `@fontsource`), no
      analytics.

**Contract changes made during Step 3** (all additive per
`docs/adr/0010-api-v1-change-process.md` — new fields/endpoints/headers
only, nothing renamed or tightened; `redocly lint` stays at 0 errors and
`verify-generated` stays clean): `Issue.title`/`primaryCveId`/
`assetLabelUntrusted` (denormalised so the list doesn't need a per-row
join), `Vulnerability.title` (short name distinct from the full
`description`), `User.mustChangePassword`, `FalsePositiveReasonCode`
(documents MOD-11's controlled vocabulary for client use, without
tightening the free-string `reasonCode` field itself), a `CorrelationId`
response header on every error response (`OPS-01`), `GET
/retention-policies/{dataClass}` (the PATCH needs an `If-Match` and the
list endpoint carried no per-item ETag to get one from), and
`DashboardSummary.exceptionsApproachingExpiry` (resolves
`docs/design/review.md`'s open question on whether that tile was real —
yes, backed by actual exception records).

**What GATE 3 still needs before it can be called closed** — real gaps,
not hedging:

- A full automated accessibility audit of the built screens. Storybook's
  `addon-a11y` (`test: 'error'`) covers the atom-level component catalogue
  from Step 3's groundwork; the ten screens built this session have not
  had an automated axe pass or the required manual keyboard-only pass
  (`QA-06`) run against them yet.
- Automated, CI-enforced verification at `PERF-01` scale. This session
  manually verified Issues renders and stays responsive against the real
  5,000/50,000/250,000 `perf01` fixture (see above), but there is no
  scripted load test yet — that's `QA-04`'s nightly job, which does not
  exist until Step 5.
- The three-reviewer scripted walkthrough GATE 3 requires, at least one a
  practising security operator. That is a human process this session
  cannot perform on your behalf.

## Status: real scanning pipeline and CVE intelligence (partial, ahead of the formal step sequence)

Two chunks of Step 4/`docs/cve-intel-feature-spec.md` work exist and run for
real against `deploy/compose`, done out of the strict step order because the
scan pipeline was found completely unwired (`apps/worker` was a no-op stub)
and the intelligence feature was requested as real integration rather than
a spec document. Neither is the full scope of its respective spec — read
both docs before treating either as done.

**Scanning (`apps/worker`, `packages/scanner-adapters`):** a DB-poll job
runner (no BullMQ — see `apps/worker/src/main.ts`'s own comment on why) and
a real `TcpConnectDiscoveryAdapter` (plain `node:net` connect + banner
grab, not Nmap — `docs/licence-review.md` Finding 1 blocks bundling Nmap on
an unresolved OEM licence). Verified against a real `/24` LAN: real open
ports, real banners, a small hand-curated CVE seed
(`packages/scanner-adapters/src/known-vulnerability-seed.ts`) for
matching. `docs/adr/0008-worker-capabilities.md` records why `NET_RAW` was
removed.

**CVE intelligence (`apps/api/src/routes/intel.ts`,
`apps/worker/src/pipeline/process-intel-import.ts`, Admin → Intelligence
tab):** a real, live-verified sync against the NVD 2.0 API and the FIRST
EPSS bulk dataset, applying `FEED-03`/`FEED-04`'s retention rule
(known-exploited, or CVSS ≥ floor, or EPSS ≥ threshold — never a
publication-year cutoff), staged and applied atomically per `FEED-25`,
with `FEED-22` egress-window audit events and the `FEED-23` permanent
disable switch. Verified live: a 3-day NVD window fetched 2,198 CVEs,
retained 1,623, correctly discarded 575, with real CVSS v3.1/v4.0 vectors
and real `cisaExploitAdd`-derived known-exploited flags landing in
`vulnerabilities`.

Known, deliberate gaps against the full spec — not silently dropped:
- `FEED-08.2` (CISA KEV direct fetch) is **not implemented**: `cisa.gov`
  returned a `403` from this development network's edge (Akamai bot
  protection), so it could not be built against real traffic. NVD's own
  `cisaExploitAdd` annotation is used as the known-exploited signal
  instead — accurate, but a substitute, not the dedicated adapter `FEED-08`
  calls for.
- `FEED-02` (CPE-family allowlist) is not implemented — this sync applies
  only the severity/exploit-probability/known-exploited retention rule.
  Do not point a full historical backfill (no `modifiedSinceDays` bound) at
  this code without adding the family filter first, or `FEED-06`'s size
  budget will not hold.
- No scheduled sync (`FEED-13`/14/15's automatic path) — manual "Update
  now" only. `FEED-20` (proxy) is not implemented.
- `MATCH-01` through `MATCH-13` (provenance chain, curated product
  mapping, backport awareness, confidence assignment beyond the fixed
  0.35/0.75 used today) are not implemented — matching still uses the
  small hand-seeded matcher from the scanning work above, now sitting next
  to a much larger real corpus it doesn't yet search.
- `PROF-*` (asset vulnerability profile), the `UI-103`–`117` panel surfaces
  beyond the Intelligence tab itself (issue-detail Vulnerability/Matching
  tabs, asset-detail rework), `RPT-*` (reporting rework), and `ACC-*` (the
  acceptance lab) are not implemented.

## Status: multiplicative risk scoring (`docs/issues-scoring-dashboard-spec.md` §2, real)

`SCORE-01` through `SCORE-08` are implemented for real and verified live
against the running stack — `packages/domain/src/scoring/risk-scoring.ts`'s
`computeRiskScore` (issue score) and new `computeAssetRiskRating` (asset
rating) replace ADR-0004's GATE-1 weighted-sum function with the spec's
`base × exploit × exposure × criticality × confidence` model. 20 unit
tests cover both functions, including the known-exploited floor
(`SCORE-06`), the breadth-bonus cap (`SCORE-07`), and the exact case
`SCORE-03` cites as the old function's flaw (a low-severity known-exploited
issue no longer outranks a genuinely severe unexploited one). Migration
`0012` adds the `isolated` exposure tier, `assets.risk_rating`/`risk_band`,
and seeds `risk_scoring_policies` version 2 as active (version 1 stays
untouched — `MOD-18` — so pre-existing issues' snapshots stay replayable
against the function that actually scored them).

Verified live end to end: deleted and forced a real re-scan of an existing
finding (a real host's Telnet port) and confirmed the fresh issue landed
with `riskScorePolicyVersion: 2`, a hand-checked-correct `riskScore`,
severity derived from the score's band, and — for the first time —
`assets.risk_rating`/`risk_band` populated. Also closed a real,
pre-existing gap found while doing this: `GET /issues/{id}` was missing
`asset`/`vulnerability`/`observations`/`riskScoreBreakdown` entirely
(required fields on `IssueDetail`) — `IssueDetailPanel.tsx` would have
thrown on real data, mocks only. Now reuses `assets.ts`'s existing
`toAsset`/`loadNestedCollections` rather than a second implementation.

`RiskExplainer`'s breakdown display changed from an additive "+/-"
contribution to input → multiplier → running score, since a multiplicative
factor has no honest way to render as a signed delta.

Deliberately not implemented (documented, not silently dropped): `GRP-*`
(remediation grouping on the Issues screen), `ISS-*` (the Issues screen
column/facet/six-tab rework), `CHART-*` (the third chart primitive,
`Matrix`), `DSH-*` (the dashboard rework and its pre-computed aggregate
tables), and the `ACC-10`–`15` acceptance harness extensions. `SCORE-02`'s
"documented table" of finding-class base scores is a two-entry stopgap
(`fallbackCvssBase` in `apps/worker/src/pipeline/process-scan-run.ts`,
mirrored in the mock server) covering only "known-exploited, no CVSS" and
"not exploited, no CVSS" — a real per-finding-class table is still open.

## Repository layout

```
apps/
  web/          React + Vite panel — all ten Step 3 screens, built against
                mock-server. Router/i18n/theme/session live in src/app,
                src/i18n, src/theme, src/auth; one directory per screen
                (issues/, assets/, scans/, scope/, exceptions/, dashboard/,
                reports/, admin/, setup/) each holding its page(s), query
                hooks, and screen-local components.
  api/          Fastify API (routes land in Step 4; health endpoints only so far)
  worker/       Pipeline runner (Step 4)
  mock-server/  Step 2.4: Fastify + openapi-backend server that routes,
                validates, and serves realistic data directly against
                packages/contracts/src/openapi.yaml — what apps/web builds
                against in Step 3, before any real backend exists.
packages/
  domain/            Framework-free domain types, fingerprint/risk-scoring
                      function signatures, and the Part F extension-seam
                      interfaces (EXT-01..EXT-09)
  contracts/         OpenAPI 3.1 spec (single source of truth) + generated
                      TypeScript client (openapi-typescript/openapi-fetch,
                      never hand-written) — Step 2, frozen at v1 (GATE 2)
  scanner-adapters/  ScannerAdapter interface (Step 4 implements the two
                      concrete adapters)
deploy/compose/      Reference single-VPS deployment (Docker Compose)
docs/
  adr/               Architecture decision records
  database-schema.md Full schema design with a requirement-traceability matrix
  licence-review.md  LEG-01/LEG-02 bundled-component licence audit
  threat-model.md    STRIDE analysis (SEC-14)
  cve-intel-feature-spec.md
                      FEED-*/MATCH-*/PROF-*/RPT-*/ACC-* addendum: NVD/KEV/EPSS
                      intelligence sync, CPE matching, asset risk profile,
                      and the reporting rework -- folds into Step 2/3 before
                      GATE 3 per its own EXEC-10 note, not a later increment
  issues-scoring-dashboard-spec.md
                      SCORE-*/GRP-*/ISS-*/CHART-*/DSH-*/ACC-* addendum: the
                      multiplicative risk-scoring model (SCORE-* is real --
                      see the README status section -- the rest isn't yet)
  design/            panel-design-spec.md (the full UI-* companion spec) plus
                      the wireframes/review notes Step 3 was built against
  runbooks/          Operational runbooks (Step 5)
scripts/
  generate-sbom.mjs               LEG-04: CycloneDX SBOM generation
  assert-no-remote-exec-deps.mjs  PRIN-03: CI gate against forbidden dependencies
```

## Working with the monorepo

Package manager: **pnpm** via `packageManager` in `package.json` (Corepack).
If Corepack isn't available in your environment, `npx pnpm@9 <command>` works
identically.

```bash
pnpm install
pnpm build        # turbo run build, all packages
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration   # requires DATABASE_URL/REDIS_URL against a real Postgres/Redis (see CI workflow)
pnpm sbom
pnpm assert:no-remote-exec-deps
```

Every package/app was verified individually during Step 1 (typecheck, lint,
unit tests, and — for `apps/web` — a production `vite build`), plus a full
`up → down → up` migration cycle against real Postgres 16 in Docker. See
`.github/workflows/ci.yml` for how this runs in CI, including integration
tests against real Postgres and Redis/Valkey service containers (`QA-01`:
never mocked).

## Running the mock server (Step 2.4 / Step 3)

```bash
pnpm --filter @xenitex/contracts build   # generates src/generated/types.ts from openapi.yaml
pnpm --filter @xenitex/mock-server dev   # http://127.0.0.1:8081/v1/...
```

`MOCK_SERVER_FIXTURE_SCALE=small` (default `perf01`) generates a much smaller
fixture for fast local iteration; the full `perf01` fixture takes ~15s to
generate and boot and uses a few hundred MB of memory. Useful headers for
manual testing: `X-Mock-Role: viewer|analyst|operator|administrator`
(bypasses the login flow), `X-Mock-Latency: 0` (disable simulated latency),
`X-Mock-Force-Status: 503` / `X-Mock-Fail-Rate: 0.2` (error-state testing).
`MOCK_SERVER_SETUP_INCOMPLETE=true` boots with an unfinished first-run
wizard (P1-06) instead of a pre-completed org, so `3.1`'s actual setup
screens have something real to walk through. `GET /mock/health` is a
liveness check for the mock server itself (not part of the `openapi.yaml`
contract).

## Running the web panel (Step 3)

```bash
pnpm --filter @xenitex/contracts build   # generate types.ts if you haven't
pnpm --filter @xenitex/mock-server dev   # terminal 1 — http://127.0.0.1:8081
pnpm --filter @xenitex/web dev           # terminal 2 — http://localhost:5173
```

Vite's dev server proxies `/v1` to the mock server on the same origin (see
`vite.config.ts`) so the `SameSite=Strict` session cookie round-trips
without CORS. Seeded mock users (all with password `password123`, MFA code
`000000`): `admin@pilot-customer.example` (administrator, MFA already
enrolled), `operator@pilot-customer.example` (operator, MFA enrolled),
`analyst1@pilot-customer.example` (analyst), `analyst2@pilot-customer.example`
(analyst, seeded with `mustChangePassword: true` — signs in straight into
the forced-password-change screen), `viewer@pilot-customer.example` (viewer).

## Local deployment reference

```bash
cd deploy/compose
cp .env.example .env && chmod 600 .env

# Docker secrets (SEC-05) -- these are file-based bind mounts, so the files
# must exist before `up` runs, unlike .env which docker compose reads lazily.
# chmod 644, NOT 600: the container reads this as a non-root user (postgres,
# uid 70) that never matches your host uid, so a stricter host mode makes it
# unreadable inside the container -- verified against a real run, see
# docker-compose.yml's comment on the `postgres` service for why.
mkdir -p secrets
printf '%s' 'xenitex' > secrets/postgres_user.txt
openssl rand -base64 24 > secrets/postgres_password.txt
chmod 644 secrets/postgres_user.txt secrets/postgres_password.txt

docker compose up --build
```

`deploy/compose/secrets/` is gitignored — every clone/checkout needs to
regenerate these locally, they are never committed.

This is the **reference** deployment shape (hardening per `SEC-02`–`SEC-04`),
not yet the signed, air-gapped install artifact `5.1` produces — that's Step 5
work.

## Where to start reading

1. `docs/database-schema.md` — the data model, with every table traced back
   to a requirement ID.
2. `docs/adr/` — in order, especially 0001–0004, which are the decisions
   GATE 1 needs to actually review (not just accept by default).
3. `docs/licence-review.md` — two real licensing risks were identified here
   (Nmap/NPSL, flagged as expected by the master prompt; Redis's 2024
   relicensing, found during Step 1 stack verification and already fixed by
   switching to Valkey).
4. `docs/threat-model.md` — first STRIDE pass; explicitly marked where it's
   still aspirational pending Step 4/5 implementation work.
5. `docs/design/` — `panel-design-spec.md` is the full companion
   specification (design brief, principles, tokens, component inventory,
   screen specs, safety-critical interface patterns, and the capability
   coverage matrix in §10); `wireframe-issues.md`, `wireframe-scan-review.md`,
   `wireframe-dashboard.md`, and `review.md` are the design-review notes
   Step 3's Issues, Scan-review, and Dashboard screens were actually built
   against. Worth reading alongside the screens themselves to see which
   layout decisions came from trying real content, not guesswork.
6. `apps/web/src/issues/IssuesPage.tsx` and `IssueDetailPanel.tsx` — the
   flagship screen; read these first among the Step 3 code, everything
   else follows the same container/presentational + query-hook pattern.
7. `packages/contracts/src/openapi.yaml` — the frozen v1 API contract;
   `docs/adr/0010-api-v1-change-process.md` for what "frozen" permits.
8. `docs/cve-intel-feature-spec.md` — not yet implemented. Addendum
   requirements (`FEED-*`/`MATCH-*`/`PROF-*`/`RPT-*`/`ACC-*`) for real
   NVD/CISA-KEV/EPSS intelligence sync, CPE-based detection matching, the
   per-asset vulnerability profile, and five report templates. Its own text
   is explicit that this must fold into Step 2's contract and Step 3's
   panel before GATE 3, not land as a later increment — read before doing
   any further Step 2/3 work, since it changes both.
9. `docs/issues-scoring-dashboard-spec.md` — its `SCORE-*` section (the
   multiplicative risk-scoring model) is implemented for real; `GRP-*`,
   `ISS-*`, `CHART-*`, `DSH-*`, and its `ACC-*` extensions are not. See the
   README status section above for exactly what's real and what's
   deferred, and `docs/adr/0004-risk-scoring-function.md`'s "Update" for
   why the scoring function changed shape.
