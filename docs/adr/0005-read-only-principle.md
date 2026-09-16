# ADR 0005: The read-only principle and its enforcement

- Status: Accepted (this is a foundational product decision from Part A.2,
  not one this ADR is proposing — it documents _how_ it's enforced so the
  enforcement itself can be reviewed)
- Requirements: `PRIN-01`, `PRIN-02`, `PRIN-03`, Part E (Trust Ladder), `ANTI-10`

## Context

`PRIN-01`–`PRIN-03` are stated as the defining architectural decision, and
Part A.2 gives the actual commercial reason: it lets the sales conversation
say "if this appliance were fully compromised, the attacker gains a list of
your problems, not the ability to cause new ones." That claim is only true
if it's enforced structurally, not by convention — a single SSH-exec call
added under schedule pressure six months in would make the claim false
retroactively for every customer who heard it. This ADR exists to record
_how_ the claim stays true, so the enforcement mechanism itself is something
the team agreed to, not something one engineer decided unilaterally.

## Decision

Three independent layers, none of which is "remember not to":

1. **No credential storage, period (`PRIN-02`).** There is no
   `credentials` table, no vault, no encrypted-secrets-for-customer-systems
   column anywhere in `docs/database-schema.md`. This isn't an access-control
   decision (permission checks that could be misconfigured) — the schema
   has no place to put a customer credential even if someone tried. See
   §15 of that document, "deliberately out of scope."
2. **Interface-level closure (`EXT-09`).** `RemediationExecutor` in
   `packages/domain/src/extensions/remediation-executor.ts` exists as a type
   only so the eventual Rung 3 interface (Part E) has a stable shape to land
   against later — but its single implementation
   (`UnavailableRemediationExecutor`) unconditionally throws, and
   `feature_flags.remediation_executor_enabled` is seeded hard-`false` in
   the initial migration. `AdvisoryProvider` (`EXT-03`) is the read-only
   sibling: its output type (`AdvisoryRecommendation`) is closed to an
   advisory-ID selection plus display text — see ADR-equivalent reasoning
   inline in `advisory-provider.ts` (`AIP-03`) — so even a future
   model-backed implementation has no field that could carry an executable
   instruction.
3. **CI-enforced dependency assertion (`PRIN-03`).** `scripts/assert-no-remote-exec-deps.mjs`
   fails the build if any SSH client or remote-execution/configuration-management
   library appears anywhere in the resolved dependency tree (checked against
   the CycloneDX SBOM, or the raw pnpm graph if no SBOM has been generated
   yet). This is deliberately a CI gate, not a code-review checklist item —
   checklist items get skipped under deadline pressure; a failing build does
   not merge.

Additionally, `docker-compose.yml`'s `worker` container is the only one with
any elevated capability (`NET_RAW`, justified in ADR 0008), and even that
capability is for local network _discovery_ (SEC-03's scanner containers),
never for executing anything on a remote host — `cap_drop: ALL` everywhere
else, and no container in this deployment has an outbound path to arbitrary
customer infrastructure beyond the scan targets within an accepted
`authorized_scope`.

## Consequences

- Every future capability that touches a customer system is _earned_
  against Part E's trust ladder, not assumed. Rung 1 (credentialed read)
  requires three renewed pilots, a passed external pentest, and an
  independently reviewed credential-handling design — none of which this
  codebase can satisfy by itself; it's a business-process gate as much as a
  technical one, and this ADR does not attempt to pre-approve it.
- The CI dependency assertion (layer 3) is a blunt instrument: it catches a
  known-bad package name, not a hand-rolled TCP client that does something
  SSH-shaped without being named `ssh2`. It is a backstop against accidental
  reintroduction, not a substitute for `SEC-13`-style code review on
  anything touching network I/O outside the scanner adapter boundary.
- `PRIN-03`'s denylist (`scripts/assert-no-remote-exec-deps.mjs`) is
  maintained by hand and will need entries added as new categories of
  forbidden dependency are identified — this is accepted as ongoing
  maintenance, not a one-time setup cost.

## Alternatives considered

- **Policy-only enforcement (a documented rule, checked in code review).**
  Rejected: this is exactly the "policy, not a deliberate trust strategy"
  framing Part A.2 explicitly rejects. A rule that isn't automatically
  checked doesn't survive contact with a deadline.
- **Runtime feature-flag gating instead of interface closure for
  `RemediationExecutor`.** Rejected: `EXT-07`'s own ADR requirement says
  client-side/config-driven flags are not an enforcement mechanism — genuine
  gating is server-side capability, and for something this consequential
  the strongest available form of "server-side capability" is "the
  implementation does not exist and the interface's output type cannot
  reach an execution surface even if it did."
