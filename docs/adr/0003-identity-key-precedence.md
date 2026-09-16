# ADR 0003: Identity-key precedence order and merge policy

- Status: Accepted at GATE 1. Open question resolved: `fqdn` stays in the
  precedence order at lowest rank rather than being excluded.
- Requirements: `MOD-05`, `MOD-06`, `MOD-07`

## Context

`MOD-05` states the rule this whole ADR exists to enforce: **an address is
never an identity.** IP addresses get reassigned by DHCP, NAT means many
hosts share one address from a scanner's vantage point, and hostnames get
reused. Without a strict, documented precedence order over the identity
signals actually available (`MOD-01`: machine UUID, serial number, MAC
address, FQDN, certificate fingerprint), identity resolution has no way to
decide which of two conflicting signals wins, and `MOD-07`'s DHCP-churn
fixture (one host, three scans, changing address, must resolve to one asset)
has no deterministic answer.

## Decision

**v1 precedence order** (highest confidence first):

1. `machine_uuid` — vendor/OS-assigned unique identifier, effectively
   never collides or changes for the life of the machine.
2. `certificate_fingerprint` — strong signal when present (TLS services with
   a stable cert), but not universal and can legitimately rotate on
   cert renewal, which is why it sits below machine UUID rather than above it.
3. `serial_number` — hardware-level identifier, strong but not always
   exposed over the network (many services don't leak it).
4. `mac_address` — stable within a single L2 segment but trivially spoofable
   and meaningless across routed networks or behind virtualization (a VM's
   vNIC MAC is not a hardware fact worth much confidence).
5. `fqdn` — weakest of the five: DNS can point a name at a different host at
   any time, and this is the signal most likely to be attacker-influenced
   (a hostname is often derived from a scanner-observed banner/reverse-DNS,
   which is untrusted data per `SEC-17`).

A match on a higher-precedence key always wins over a match (or conflict)
on a lower-precedence key, regardless of confidence score, when both are
present for the same candidate. Confidence scores (per-key, `MOD-05`) are
used to decide _whether a given key match counts as a match at all_ against
`identity_resolution_policies.merge_confidence_threshold`, and to route
low-confidence matches to the operator review queue (`MOD-06`) instead of
auto-merging — see `IdentityResolutionOutcome` in
`packages/domain/src/identity/identity-resolution.ts`.

**Merge policy:** automatic merge only above the confidence threshold on the
highest-precedence available key; anything below threshold becomes a
`low_confidence_candidate` outcome for operator review, never a silent
merge. Every merge (automatic or operator-confirmed) is recorded in
`asset_merge_events` with the policy version and matched key, and is
reversible by an operator (`MOD-06`) — reversal does not delete the merged
asset's history, it clears `merged_into_asset_id` and restores it to
`active`.

This is `identity_resolution_policies.version = 1` — versioned per ADR 0002's
precedent, because changing precedence retroactively changes which asset a
given key resolves to, which is exactly the kind of one-way-door decision
that needs a version bump and a documented migration story, not a runtime
config toggle.

## Consequences

- The `MOD-07` DHCP-churn fixture works by construction: address is not in
  the precedence list at all, so a changing address never triggers a
  re-resolution decision — only `asset_address_history` gets a new row.
- NAT (many real hosts, one apparent source address to the scanner) is
  **not** solved by address exclusion alone — it's solved by the fact that
  each real host, if it exposes any of the five identity keys, resolves
  independently of the shared address. A host behind NAT that exposes
  _none_ of the five keys cannot be distinguished from its NAT-mates by this
  policy; it falls back to provisional per-address asset creation (see ADR
  0002's open question) and stays a known limitation, not a silently wrong
  answer.
- Risk flagged for GATE 1: is FQDN worth including in the precedence order
  at all, given it's explicitly the weakest and most attacker-influenced
  signal? This ADR proposes keeping it at lowest precedence rather than
  excluding it, because some asset classes (some managed Windows fleets, for
  instance) may expose little else — but this is a judgment call the team
  should confirm, not something to accept by default.

## Alternatives considered

- **Weighted-sum scoring across all keys instead of strict precedence.**
  Rejected for v1: strict precedence is auditable and explainable in one
  sentence ("machine UUID always wins"), which matters for the same reason
  `MOD-17` insists risk scores be explainable — an operator reviewing a
  merge decision needs to be able to say why it happened. A weighted-sum
  model is harder to explain and harder to test deterministically. Revisit
  if v1 precedence proves too rigid in the pilot (`6.3`/`6.4` metrics may
  surface this).
- **No merge review queue — always auto-merge above a single global
  threshold.** Rejected: directly contradicts `MOD-06`'s requirement for an
  operator review view of low-confidence candidates.
