# Licence Review — Bundled Components

- Status: Draft for Step 1 (`1.5`). `LEG-02` requires this resolved before
  packaging, not at release, because the Nmap question can change the
  packaging model. **Two items below require an actual decision from
  whoever owns legal/business risk for this company — an engineering agent
  can identify and characterise the risk, but cannot conclude a licence
  negotiation or render a legal opinion.** Flagging that explicitly per
  `WORK-04` rather than marking this "resolved."
- Requirements: `LEG-01`, `LEG-02`, `LEG-03`, `LEG-04`

## How to read this table

"Redistribution" means: the component ships inside the signed offline
install bundle (`5.1`) or a container image we build and hand to the
customer. It does not mean the customer separately downloads and installs
something themselves on the same VPS — that's a different licensing
question per-component (see the Nmap discussion below).

| Component                                                | Version (as scaffolded)                           | Licence                                                                             | Commercial closed-source redistribution?                            |
| -------------------------------------------------------- | ------------------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| PostgreSQL                                               | 16                                                | PostgreSQL License (permissive, BSD-style)                                          | Yes, no restriction                                                 |
| Valkey (replaces Redis — see Finding 2)                  | 8-alpine                                          | BSD-3-Clause                                                                        | Yes, no restriction                                                 |
| Fastify                                                  | 5.x                                               | MIT                                                                                 | Yes                                                                 |
| Zod                                                      | 3.x                                               | MIT                                                                                 | Yes                                                                 |
| React / React DOM                                        | 18.x                                              | MIT                                                                                 | Yes                                                                 |
| Vite / Vitest                                            | 5.x / 2.x                                         | MIT                                                                                 | Yes                                                                 |
| Kysely (proposed, Step 4)                                | —                                                 | MIT                                                                                 | Yes                                                                 |
| node-pg-migrate or equivalent runner (Step 4)            | —                                                 | MIT                                                                                 | Yes                                                                 |
| ESLint / typescript-eslint / Prettier / Turborepo / pnpm | —                                                 | MIT                                                                                 | Yes (build tooling only, not redistributed to customers)            |
| argon2 bindings (Step 4, `SEC-07`)                       | —                                                 | MIT/Apache-2.0 (bindings); reference Argon2 C implementation is CC0/Apache-2.0 dual | Yes                                                                 |
| TOTP library (Step 4, `SEC-09`)                          | —                                                 | MIT (typical for `otplib`/similar)                                                  | Yes — confirm exact package choice against this table when selected |
| nginx (serving `apps/web` static build)                  | `nginxinc/nginx-unprivileged`                     | BSD-2-Clause                                                                        | Yes                                                                 |
| **Nmap**                                                 | proposed for `network-discovery` adapter, `P2-04` | **Nmap Public Source License (NPSL)**                                               | **No, not without an OEM licence — see below**                      |
| **Nuclei**                                               | proposed for `template-checks` adapter, `P2-05`   | MIT                                                                                 | Yes, no restriction                                                 |

## Finding 1 (`LEG-02`, as flagged in the master prompt): Nmap / NPSL

Nmap is licensed under the Nmap Public Source License, a modified GPLv2 with
additional terms specific to the Nmap Project (Fyodor/Insecure.Com LLC). The
clause that matters here: NPSL treats bundling Nmap inside a **closed-source
commercial product** as a form of distribution requiring a **separately
purchased OEM licence** from the Nmap Project — the standard GPLv2 copyleft
"you may redistribute if you also open your own source" escape hatch does
not apply to a company that intends to keep the appliance closed-source,
which this product does (per Part A, there is no indication anywhere in the
master prompt that the appliance's source is meant to be open).

**This is a business decision, not an engineering one.** Three paths, in
order of how much they change the packaging model:

1. **Purchase an Nmap OEM licence** before Step 5.1 packaging. Keeps the
   network-discovery adapter's implementation simplest (wrap the real Nmap
   binary, parse its XML output per `P2-04`'s "structured output only"
   requirement). Cost and terms need to come from Nmap Project directly —
   not something to estimate here.
2. **Do not bundle Nmap in the signed offline install artifact.** Instead,
   document Nmap as a customer-provided external dependency the appliance
   invokes if present on the host/in a customer-supplied container, and
   degrade gracefully (adapter reports `capabilities()` without discovery
   support) if it's absent. This avoids "we redistribute it," but the
   product's "no package installation, no image pull... at install time"
   promise (`5.1`) is directly in tension with asking the customer to
   separately obtain Nmap — flagging this tension rather than picking a side
   here, because it changes what "air-gapped, self-contained install" means
   for this specific adapter.
3. **Build the network-discovery adapter on a component with a compatible
   licence** (candidates: a permissively-licensed or copyleft-but-fee-free
   SYN-scan implementation, or a smaller purpose-built discovery tool).
   `LEG-03`'s adapter boundary (`ScannerAdapter` interface,
   `packages/scanner-adapters`) exists specifically so this substitution
   requires zero changes to the pipeline, the domain model, or anything
   above the adapter — this was a design decision made in Step 1 exactly
   because this licence question was known to be open.

**Recommendation:** do not default to bundling Nmap in the reference build
until path 1 is actually resolved with the Nmap Project. Treat the
network-discovery adapter's concrete implementation as blocked on this
decision, which is why Step 4's adapter work references this document rather
than assuming Nmap.

## Finding 2 (identified during Step 1 stack verification, not in the

original master prompt list — flagged per `WORK-03`): Redis licensing

Redis Ltd. relicensed Redis from BSD-3-Clause to a dual **RSALv2 / SSPLv1**
license starting with **Redis 7.4** (announced March 2024). Neither RSALv2
nor SSPLv1 is an OSI-approved open-source licence, and both carry
redistribution restrictions relevant to a commercial closed-source product:

- **RSALv2** prohibits using the software to provide a "database product"
  to third parties in a way that competes with Redis Ltd.'s offerings. This
  appliance uses Redis purely as an internal job queue/cache, never exposed
  to the customer as a database product in its own right — but "internal
  use inside a product we sell" sits close enough to the licence's actual
  wording that it is not something to self-certify as clearly fine without
  review.
- **SSPLv1**'s main trigger (offering the software "as a service") is a
  weaker concern for on-premise, customer-installed software, but it still
  applies to how Redis itself is licensed and redistributed, not just to how
  we'd operate a hosted service.

`docker-compose.yml` originally scaffolded in Step 1 specified
`redis:7-alpine`, which resolves to whatever the latest 7.x patch is at
build time — **that was itself a defect**: an unpinned tag can silently
cross the 7.2 → 7.4 licence boundary on a routine rebuild with no code
change to review.

**Applied fix:** `deploy/compose/docker-compose.yml` now uses
`valkey/valkey:8-alpine` instead. Valkey is the Linux Foundation-backed,
BSD-3-Clause-licensed fork of pre-relicense Redis, created by the original
Redis maintainers specifically in response to this relicensing, and is
wire-protocol-compatible — `ioredis`/`node-redis` clients and BullMQ
(proposed for Step 4 queue work) work against it unmodified. This removes
the licensing question entirely rather than managing around it, and was a
low-risk enough change (a compose image swap, no application code depends
on the substring "redis" anywhere) to make directly rather than leave as an
open recommendation. The compose service is still named `redis:` (just a
hostname/service key, not a claim about the software) so `REDIS_URL`-style
env vars stay conventional.

Remaining action: pin to a digest, not just the `:8-alpine` tag, for the
actual signed release artifact (`5.1`/`LEG-04`) — a floating tag is still a
supply-chain risk independent of the licence question this section is about.

## `LEG-03` / `LEG-04` status

- `LEG-03` (adapter boundary allows replacing a failing-review component
  with no core changes): satisfied by design — see
  `packages/scanner-adapters/src/scanner-adapter.ts` and
  `docs/adr/0005-read-only-principle.md`. Untested against an actual
  substitution yet; that's a Step 4 exercise once a real second adapter
  implementation exists.
- `LEG-04` (CycloneDX SBOM per release artifact + `PRIN-03` assertion):
  implemented — `scripts/generate-sbom.mjs` (via `cdxgen`) and
  `scripts/assert-no-remote-exec-deps.mjs`, wired into
  `.github/workflows/ci.yml`'s `supply-chain` job. Verified locally against
  the real Step 1 dependency tree (378 packages, zero PRIN-03 violations)
  and against a synthetic SBOM containing a known-bad package (`ssh2`) to
  confirm the check actually fails when it should, not just passes
  trivially.

## Open items requiring a decision before GATE 5 (`5.7`/`LEG-02` sign-off)

1. Nmap: OEM licence, external-dependency model, or component substitution —
   pick one and update `LEG-02`'s status from "flagged" to "resolved" with
   the actual decision and (if applicable) licence terms recorded here.
2. ~~Redis vs. Valkey vs. pinned Redis 7.2~~ — resolved: switched to Valkey
   (see Finding 2). Remaining: pin the release artifact to a digest.
3. Confirm the actual TOTP library chosen in Step 4 against this table
   (left as a placeholder above since no package is pinned yet).
