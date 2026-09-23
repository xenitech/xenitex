# ADR 0004: Risk scoring function and default weights

- Status: **Superseded** by `docs/issues-scoring-dashboard-spec.md` §2
  (`SCORE-01`–`SCORE-08`) — see "Update" at the end of this ADR. Kept in
  full below for history: `risk_scoring_policies` version 1 (this ADR's
  weighted-sum function) is still stored and still what version-1 issues'
  `issue_risk_score_snapshots` rows replay against (`MOD-18`).
- Requirements: `MOD-15`, `MOD-16`, `MOD-17`, `MOD-18`

## Context

This is called out in the master prompt as "the core commercial differentiator,"
and for good reason: `QA-00` already concedes the false-positive rate on
version-inference findings will be meaningful. If the product's response to
imprecise detection is _also_ an undiscriminating ranking — everything
labelled "critical" — it has failed on both axes at once. `MOD-16` names the
specific failure mode to avoid: a list of twelve thousand equally "critical"
items is useless regardless of how accurate any individual item is.

The function must be pure (`MOD-15`: no I/O, no hidden state — see the
`RiskFactors`/`RiskScoringPolicy` → `RiskScoreResult` signature already fixed
in `risk-scoring.ts`) so that `issue_risk_score_snapshots.factor_breakdown`
is a faithful, replayable record, and explainable in one screen (`MOD-17`).

## Decision

**Normalise each factor to a 0–100 scale, take a weighted sum over five of
the six factors, then apply confidence as a multiplier rather than a sixth
additive term.**

Normalisation:

| Factor                  | Input                                    | Normalised (0–100)      |
| ----------------------- | ---------------------------------------- | ----------------------- |
| CVSS base               | 0–10                                     | `value * 10`            |
| Exploit probability     | 0–1 (EPSS-style)                         | `value * 100`           |
| Known-exploited         | boolean                                  | `100` if true, else `0` |
| Exposure classification | `external \| dmz \| internal \| unknown` | `100 / 60 / 30 / 50`    |
| Asset criticality       | `critical \| high \| medium \| low`      | `100 / 75 / 50 / 25`    |

Default weights (`DEFAULT_RISK_SCORING_WEIGHTS`, already in `risk-scoring.ts`),
summing to 1.0 across the five additive factors:

```
cvss:               0.15
exploitProbability: 0.30
knownExploited:     0.30
exposure:           0.15
criticality:        0.10
```

```
rawScore = 0.15·cvss + 0.30·exploitProbability + 0.30·knownExploited
         + 0.15·exposure + 0.10·criticality

finalScore = rawScore × (0.4 + 0.6 × confidence)
```

Confidence is a **multiplier with a floor of 0.4**, not an additive term and
not a hard zero: a single-adapter, version-inference-only finding
(`MOD-19`'s explicit low-confidence case) is discounted, never hidden — it
can still surface as high risk if the underlying factors are severe enough,
just visibly lower than an equivalent corroborated finding (`MOD-09`). A
floor of 0.0 was considered and rejected: it would make a real, dangerous,
single-source finding invisible in a risk-sorted list, which contradicts
`MOD-21`'s spirit (every finding stays inspectable) even though it's
technically an `MOD-19`/`MOD-20` presentation concern, not an evidence one.

### Worked example (validates `MOD-16`)

|                                        | CVSS | Known-exploited | Exploit prob. | Exposure | Criticality | Confidence | **Final score** |
| -------------------------------------- | ---- | --------------- | ------------- | -------- | ----------- | ---------- | --------------- |
| Issue A — high CVSS, no known exploit  | 9.8  | false           | 0.05          | external | high        | 0.8        | **34.1**        |
| Issue B — medium CVSS, known-exploited | 5.5  | true            | 0.90          | external | high        | 0.8        | **77.2**        |

Issue B outranks Issue A by more than 2× despite a nearly 4-point-lower CVSS
base score, because known-exploited status and exploit probability carry
0.60 combined weight against CVSS's 0.15 — this is `MOD-16` made concrete,
not asserted.

### Explainability (`MOD-17`)

`issue_risk_score_snapshots.factor_breakdown` stores exactly the rows of the
table above (factor, raw value, weight, contribution) for every score
computation, keyed to `risk_scoring_policies.version`. The UI's "why this
score" panel is a direct render of that array — there is no separate
explanation-generation step to keep in sync with the scoring function, by
construction.

### Weight changes (`MOD-18`)

Changing `risk_scoring_policies.weights` creates a new policy version (never
mutates an existing one — `uq_one_active_risk_policy` enforces exactly one
active version) and triggers a background job that recomputes every open
issue's score, inserting a new `issue_risk_score_snapshots` row per issue
with `trigger = 'weights_changed'`. Prior snapshots are untouched, so a
report generated last week remains reproducible against the policy version
it was actually computed under (4.8's reproducibility requirement).

## Consequences

- Five tunable weights plus one confidence-floor constant is a small enough
  surface that a customer's security team can be shown the whole function on
  one slide — matching `MOD-17`'s "explain to a sceptical security engineer"
  bar.
- The confidence floor (0.4) is the single most debatable constant in this
  ADR and should get explicit GATE 1 sign-off rather than passing by
  default — reasonable people could argue for a lower or higher floor, or
  for confidence gating visibility rather than just score.
- `6.3`/`6.4`'s pilot metrics (does the top-20 list match what a real security
  team considers their top problems; does the confidence label predict
  false-positive dismissal) are the actual validation of these weights, not
  this ADR. Treat the numbers above as the reviewed starting point, not the
  final answer — `MOD-18`'s recomputation machinery exists specifically so
  they can move without a schema change.

## Alternatives considered

- **Confidence as a sixth additive weighted term.** Rejected: a term that
  can only ever add score doesn't achieve `MOD-20`'s "never present
  low-confidence inference with the same visual weight as direct evidence" —
  it would need a negative weight, which is a confusing way to express
  "confidence should suppress, not contribute."
- **Multiplicative confidence with a 0.0 floor.** Rejected per the worked
  discussion above — risks a real single-source finding disappearing from a
  risk-sorted list entirely.
- **CVSS-first ranking with known-exploited as a boolean override/badge.**
  Rejected: this is close to what many existing scanners already do and is
  exactly the pattern `MOD-16` calls out as having failed the product's only
  job. A visible badge does not change sort order, and sort order is what a
  triage workflow actually consumes.

## Update: superseded by a multiplicative model

`docs/issues-scoring-dashboard-spec.md` replaces the weighted-sum function
above with `risk_score = clamp(base × exploit × exposure × criticality ×
confidence, 0, 100)` — known-exploited status is now a multiplier on
severity (1.5×) rather than a fixed +30-point additive term, so it scales
with how bad the underlying CVE already is instead of contributing the
same fixed amount to a critical and a low finding alike. This is a sharper
version of the same intent this ADR already argued for (`MOD-16`): worked
by hand against this ADR's own worked example (Log4Shell: CVSS 10.0,
known-exploited, EPSS 0.94, exposure external, criticality high,
confidence 0.94) both functions land in the mid-90s to 100 — the visible
difference is at the _other_ end. Take the same known-exploited status on
a genuinely low-severity finding (CVSS 2.0, internal, medium criticality):
the old formula's flat `+30` for known-exploited alone pushed the total
into the high-60s regardless of how minor the underlying CVE was; the new
multiplicative model scores it around 30 (low band) — 1.5× a small base is
still small. That is `SCORE-03`'s stated rationale made concrete: the old
function let known-exploited status flatten the ranking; the new one
requires it to compound with actual severity.

Implementation: `computeRiskScore` and the new `computeAssetRiskRating` in
`packages/domain/src/scoring/risk-scoring.ts`. `risk_scoring_policies`
version 2 holds the new multiplicative weights and is the active policy;
version 1 (this ADR's weights, above) is retained and `is_active = false`
— existing issues scored under version 1 keep referencing it by
`risk_score_policy_version`, so their historical `issue_risk_score_snapshots`
rows remain faithfully replayable (`MOD-18`) rather than being
silently reinterpreted under the new function.

The 0.4 confidence floor this ADR specified is also gone: the new model
uses three named confidence tiers (verified 1.00 / corroborated 0.90 /
inferred 0.75) rather than a continuous multiplier with a floor, since
`docs/cve-intel-feature-spec.md` MATCH-08 ties confidence to a discrete
evidence-fidelity classification, not a smoothly-varying number.
