# ADR 0002: Issue fingerprint tuple and versioning

- Status: Accepted at GATE 1. Open question resolved: an observation that
  fails identity resolution entirely is retained and attached to a
  low-confidence provisional asset keyed by address, auto-refingerprinted
  once identity resolution later succeeds.
- Requirements: `MOD-08`, `MOD-09`

## Context

The fingerprint is what makes an Issue an Issue rather than a re-derived
findings row: it's the stable key that lets the same underlying problem,
re-observed on scan #47, land on the same row it landed on at scan #1,
preserving `first_seen` and SLA history. Get the tuple wrong and either
(a) the same problem is reported as N unrelated new issues every scan
(useless dashboards, false SLA resets), or (b) unrelated problems collapse
into one issue (lost evidence, wrong risk score, wrong owner).

`MOD-08` is explicit that changing the algorithm requires a version bump and
a forward migration, never a silent re-fingerprint. That makes this a
one-way door worth getting right before Step 4 writes the deduplication
stage against it, not after.

## Decision

**v1 tuple:** `(identityAnchor, vulnerabilityIdentifier | null, port | null, protocol | null)`,
hashed with SHA-256, hex-encoded. Implementation: `computeFingerprint` in
`packages/domain/src/fingerprint/fingerprint.ts`; `CURRENT_FINGERPRINT_VERSION = 1`.

- **`identityAnchor`** is not the Asset's database ID. It is the specific
  identity-key value (per ADR 0003's precedence order) that identity
  resolution used to place the observation onto that asset — e.g.
  `machine_uuid:<value>` or `certificate_fingerprint:<value>`. Using the
  asset's internal ID would mean a merge/split event (`MOD-06`) silently
  changes every fingerprint on that asset, which is exactly the "destroys
  first_seen/SLA history" failure `MOD-08` forbids. Using the raw address
  would violate `MOD-05` ("an address is never an identity") directly — DHCP
  churn would fragment one real problem into a new issue every lease
  renewal.
- **`vulnerabilityIdentifier`** is `vulnerabilities.vuln_identifier` (not the
  database UUID, so a re-import of vulnerability data that regenerates IDs
  doesn't break fingerprints) when the issue has a CVE. For configuration
  and exposure issues with no CVE (`MOD-04`), this is a stable issue-type key
  instead (e.g. `config.tls.weak-cipher-suite`) — never null-and-silently-collapsed
  with other CVE-less issues on the same asset/port.
- **`port` / `protocol`** are included so that the same vulnerability present
  on two different services of the same asset (e.g. a TLS misconfiguration on
  both :443 and :8443) is correctly two issues, not one.

## Consequences

- Two adapters reporting the same `(identityAnchor, vulnerabilityIdentifier,
port, protocol)` tuple converge on one issue automatically (`MOD-09`),
  because the fingerprint is a pure function of those fields, not of which
  adapter observed them.
- A version bump (v1 → v2) requires: (a) a new `computeFingerprint`
  implementation branch keyed on the version, (b) a migration that computes
  v2 fingerprints for existing issues into new rows or a new column, (c) an
  explicit decision about what happens to `first_seen`/history for issues
  whose v1 and v2 fingerprints both resolve to "the same real problem" — this
  is an editorial judgment call each time, not something the schema can
  automate, which is why `MOD-08` insists on a forward migration rather than
  an in-place rewrite.
- Risk flagged for GATE 1: identity resolution (ADR 0003) must run _before_
  fingerprinting in the pipeline (4.4 lists them in that order:
  `... -> resolve identity -> fingerprint -> deduplicate -> ...`), so an
  observation that hasn't been resolved to a stable identity key yet cannot
  be fingerprinted. What should happen to an observation that fails identity
  resolution entirely (no usable identity key, only a bare address)? This
  ADR proposes: it is retained as an Observation (never discarded — `MOD-03`
  says never delete except by retention), attached to a low-confidence
  provisional Asset keyed by address, and re-fingerprinted automatically the
  next time identity resolution succeeds for that target. This needs
  explicit team sign-off; it is the main edge case this tuple doesn't handle
  for free.

## Alternatives considered

- **Hash the raw target address instead of an identity key.** Rejected:
  directly violates `MOD-05`/`MOD-07` (DHCP churn fixture would fail by
  construction).
- **Include the adapter key in the tuple.** Rejected: would defeat `MOD-09`
  corroboration entirely — two adapters would always produce two issues,
  never one.
- **Use the asset's database UUID as the anchor.** Rejected: breaks under
  `MOD-06` merge/reversal, see above.
