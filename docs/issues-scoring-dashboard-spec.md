# DETAILED SPECIFICATION — ISSUES SCREEN, SCORING, AND DASHBOARD

Addendum to the panel design specification and the CVE intelligence feature specification. Fold into **Step 2 (contract)** and **Step 3 (panel)** before GATE 3.

New prefixes: `SCORE-` (scoring), `GRP-` (issue grouping), `ISS-` (issues screen), `CHART-` (chart primitives), `DSH-` (dashboard).

---

# 1. A PROBLEM TO SOLVE BEFORE DESIGNING EITHER SCREEN

One outdated package produces dozens of CVEs. A single Apache httpd 2.2.8 on the reference validation target will match a large number of records. Two naive options both fail:

- **One issue per CVE, flat list.** Correct fingerprinting, correct lifecycle — and an unusable screen. A single host fills the table.
- **One issue per service, CVEs collapsed inside.** A readable screen — and a broken domain model. Fingerprints become unstable, `first_seen` is meaningless, and an individual CVE cannot be accepted or dismissed.

The resolution keeps the model and fixes the view.

- `GRP-01` **Issues remain atomic and per-CVE.** One issue per `(asset, port, protocol, vulnerability)`. `MOD-04` and `MOD-08` are unchanged.
- `GRP-02` Introduce a derived, non-persisted grouping key: the **remediation group**, `(asset, product, version)` — the unit a human actually fixes. Upgrading Apache resolves forty issues at once, so forty issues are one piece of work and should appear as one row.
- `GRP-03` The Issues screen groups by remediation group **by default**, expandable to the atomic issues inside. Grouping is switchable to flat, by asset, by CVE, or by service.
- `GRP-04` A group row displays: asset, product and version, the matched CPE, issue count, count by risk band, highest risk score in the group, highest CVSS with its version, count of known-exploited issues, highest exploit probability, the lowest confidence present in the group, and the single remediation action that resolves it.
- `GRP-05` A group's risk equals the highest risk among its issues. It is never a sum and never an average. One remote code execution is not diluted by thirty low-severity issues beside it.
- `GRP-06` Lifecycle actions do not apply to a group as a shortcut. Bulk actions on an expanded group apply to each issue individually, each producing its own audit entry and requiring the justification `MOD-11` and `MOD-12` demand. A group is a view, never an object with a state.

---

# 2. SCORING — EXACT DEFINITIONS

These are the shipped defaults. Every factor is configurable per organisation, and every factor appears in `RiskExplainer`. `MOD-15` `MOD-17`

## 2.1 Normalised severity

- `SCORE-01` Pick the base score by version precedence: v4.0, then v3.1, then v3.0, then v2. Record which was used on the issue. `MATCH-17`
- `SCORE-02` If no CVSS exists, derive a base from the finding class using a documented table (for example, cleartext credential transport, anonymous write access, exposed management interface). Never treat a missing score as zero. `MATCH-18`

## 2.2 Issue risk score, 0–100

```
base        = normalised_CVSS × 10                      → 0–100

exploit     = 1.50                       if known-exploited
            = 1.00 + (epss × 0.50)       otherwise      → 1.00–1.50

exposure    = 1.30 internet-facing
            = 1.15 DMZ or semi-trusted
            = 1.00 internal
            = 0.80 isolated segment

criticality = 1.25 critical · 1.10 high · 1.00 medium · 0.85 low

confidence  = 1.00 verified · 0.90 corroborated · 0.75 inferred

risk_score  = clamp(base × exploit × exposure × criticality × confidence, 0, 100)
```

- `SCORE-03` Known-exploited status is a multiplier, not a bonus, so it scales with severity rather than flattening the ranking. It is the largest single factor by design. `MOD-16`
- `SCORE-04` Confidence reduces the score but never suppresses the issue. An inferred critical still outranks a verified low, which is correct — but the confidence meter tells the analyst which one to check first.

## 2.3 Risk bands

| Band | Score | Default SLA |
|---|---|---|
| Critical | 90–100 | 7 days |
| High | 70–89 | 30 days |
| Medium | 40–69 | 90 days |
| Low | 15–39 | 180 days |
| Informational | 0–14 | none |

- `SCORE-05` Band thresholds and SLA durations are configurable per organisation, and the SLA matrix may additionally vary by asset criticality per `MOD-14`.

## 2.4 Asset risk rating, 0–100

```
max_risk       = highest risk_score among the asset's open issues
breadth_bonus  = min(10, 2 × (count of open issues at High or above − 1))

asset_risk     = clamp(max_risk + breadth_bonus, 0, 100)

floor rule     : if any open issue is known-exploited, asset_risk ≥ 90
```

- `SCORE-06` The known-exploited floor is deliberate and non-negotiable in the default configuration. A host carrying a known-exploited vulnerability is a critical host regardless of arithmetic, and any scoring function that can rank it otherwise is wrong.
- `SCORE-07` The breadth bonus is capped at 10 so that a long tail of medium issues can never outrank a single severe one. `PROF-02`
- `SCORE-08` The asset rating is displayed as a number with its band, never as a letter grade. `PROF-05` The asset detail explains it by listing the issue that set `max_risk`, the issues that contributed breadth, and whether the floor rule applied.

---

# 3. ISSUES SCREEN

Archetype A, list-detail split.

## 3.1 Columns

Default visible, in order:

| Column | Content | Width | Notes |
|---|---|---|---|
| Risk | `RiskBadge` — ordinal bar, score, band | 96px | The only saturated element in the row. `UI-02` |
| Issue | Title; CVE identifier below in monospace when present | flex | Group rows show product and version here |
| Asset | Hostname, address below in muted ink | 200px | Links to asset detail |
| Service | `service:port/proto` in monospace | 140px | |
| CVSS | Score with a version chip: `9.8 v3.1`, `10.0 v2` | 96px | Tabular figures. `MATCH-15` |
| KEV | Marker plus remediation due date on hover | 56px | Absent when not applicable, never a grey placeholder |
| EPSS | Percentage with one decimal | 72px | |
| Conf. | `ConfidenceMeter` | 80px | No colour. `UI-03` |
| State | `StateChip` | 96px | |
| SLA | Days remaining, or overdue count | 88px | |

Available but hidden by default: age, first seen, last seen, owner, scanner and adapter version, CWE, CPE, scan run.

- `ISS-01` Every numeric column uses tabular figures and right alignment. Columns of scores that do not align are unreadable at a glance, which defeats the point of having them.
- `ISS-02` The CVE identifier is monospace, selectable, and copyable with one click. Analysts paste these constantly; make it frictionless.
- `ISS-03` Group rows are visually distinct from atomic rows — a different background tone and an expand control — but use the same column grid so the eye tracks one set of positions. `GRP-04`
- `ISS-04` Column configuration and grouping mode persist per user per screen and are captured by saved views. `UI-43`

## 3.2 Sorting and default order

- `ISS-05` Default sort: risk score descending, then known-exploited first, then CVSS descending, then age ascending. This ordering answers the analyst's actual question — what do I do first — without any interaction.
- `ISS-06` Every column is sortable. Sorting a grouped view sorts groups by their group risk per `GRP-05`, never by member count.

## 3.3 Facets

- `ISS-07` Facet chips with live counts: risk band, known-exploited, exploit probability above a threshold, confidence level, state, SLA status, asset criticality, asset exposure, service, product, CVSS version present, has CVE or does not, CWE, scanner, owner, scan run, first seen within a period.
- `ISS-08` Facets compose as AND across dimensions and OR within one dimension. State this in the UI once, compactly; do not build a query builder.
- `ISS-09` Free-text search covers issue title, CVE identifier, product, asset hostname and address, and CPE. Searching a CVE identifier must be instant and exact-match first.

## 3.4 Shipped saved views

- `ISS-10` Ship these as read-only presets, each answering a question someone actually asks:
  - **Act today** — known-exploited, open, confidence corroborated or above
  - **Critical and high** — risk band critical or high, open
  - **Internet-exposed and severe** — exposure internet-facing, risk high or above
  - **New since last scan** — first seen in the most recent run of the selected scope
  - **Overdue** — SLA breached, open
  - **Needs verification** — confidence inferred, risk high or above — the false-positive triage queue
  - **No CVE** — exposure and configuration issues, which are otherwise easy to overlook

## 3.5 Detail panel — six tabs

Tab order: Overview, Evidence, Vulnerability, Matching, History, Related.

- `ISS-11` **Overview** opens with a five-fact row above everything else: normalised severity with its CVSS version, exploit probability, known-exploited status, confidence, and computed risk score. Below it: plain-language description, affected asset with criticality and exposure, the remediation action, owner, and SLA. `UI-112`
- `ISS-12` **Vulnerability** renders `CvssPanel`: every CVSS version present, side by side, each with its base score, its vector string in monospace, and the decoded vector as a labelled table — attack vector, attack complexity, privileges required, user interaction, scope, confidentiality, integrity, availability — each metric value written in plain language rather than as a letter. Then exploit probability with percentile and dataset date, known-exploited status with catalogue and due dates, CWE with description, publication and modification dates, references grouped by type, and the corpus version that supplied all of it. `UI-109` `MATCH-16`
- `ISS-13` **Matching** renders `ProvenanceChain` as an ordered sequence with the raw banner as captured, parsed product and version, normalisation applied, canonical CPE, matched range with its boundary operators, and resulting CVE — each step labelled scanner-emitted, curated-mapping, or inferred. Carries the "this match is wrong" action. `UI-110` `UI-111`
- `ISS-14` **Related** shows: other issues in the same remediation group; the same CVE on other assets, with a count and a one-click filter; and other issues on the same asset. The cross-asset view is how an analyst discovers that one upgrade fixes eleven hosts.

## 3.6 Performance

- `ISS-15` Grouped and flat views must both stay within the interaction budget against the `PERF-01` dataset. Group aggregates are computed in the database, never in the browser, and are returned with the group row rather than fetched per row.
- `ISS-16` Expanding a group fetches its members lazily, cursor-paginated like any other collection.
- `ISS-17` Facet counts are computed server-side against the active filter set, with a documented approximation strategy above a threshold and an honest label when a count is approximate. `UI-48`

---

# 4. CHART PRIMITIVES

This supersedes `UI-52`. The inventory grows from two primitives to three, and no further.

- `CHART-01` **`BarSeries`** — vertical, horizontal, and stacked variants; numeric-bin variant for histograms. Covers distributions, rankings, and time buckets.
- `CHART-02` **`Sparkline`** — a compact trend inside a tile or a table cell. No axes, no labels, paired with the current value.
- `CHART-03` **`Matrix`** — a small labelled grid with a per-cell count, for two-dimensional categorical breakdowns. Rendered with the neutral scale plus the risk ramp only where the cell genuinely encodes risk.

Rules carried forward unchanged from `UI-14`:

- `CHART-04` No pie or donut. No three-dimensional rendering. No dual axis. No chart with more than five series. No animated transitions on data load. `UI-16`
- `CHART-05` Every chart is readable in greyscale. Where a chart encodes risk band, the ordinal position of the segment carries the meaning and colour reinforces it. `UI-17`
- `CHART-06` Every chart has a table equivalent reachable in one click. Some readers need the numbers, some need the shape, and an auditor needs the numbers.
- `CHART-07` Every chart states its time range, its data-as-of timestamp, and the corpus version where the data depends on one. An unlabelled axis is a defect.
- `CHART-08` Every chart element is keyboard-focusable with an accessible description, and every chart is drill-through: selecting an element navigates to Issues with the exact equivalent filter applied. `UI-76`

---

# 5. DASHBOARD

Archetype B, single column, maximum 1200px, twelve-column grid. Built last, from what the working screens actually contain.

## 5.1 Tile inventory

Eight tiles. If a ninth is proposed, one must be removed.

**Row 1 — the posture summary, full width**

- `DSH-01` **Posture header.** Four figures in a row, each a large tabular number with a `Sparkline` beneath showing 30-day movement: open issues at high or above; **known-exploited issues open** — the single most important number in the product, given its own visual weight; assets at critical or high rating; issues overdue against SLA. Each figure drills through to its filtered Issues view.

**Row 2 — two tiles, six columns each**

- `DSH-02` **Risk trend.** Stacked vertical `BarSeries` over time, one bar per day for 30 days or per week for 12 weeks, segmented by risk band with critical at the base so the eye reads severity from the bottom up. Drill-through per segment to that band on that date range. Empty until at least two scans exist; before that, it states so plainly rather than drawing a single bar.
- `DSH-03` **CVSS distribution.** Horizontal `BarSeries` in numeric bins across 0–10 in half-point steps, counting open issues by their normalised CVSS. A separate, visually distinct series overlays the known-exploited subset within each bin — this is the chart that shows at a glance whether the severe end of the estate is theoretical or actively exploited. Bars carry a version-mix indicator where a bin mixes v2 and v3 scores, because those are not the same measurement. `MATCH-15`

**Row 3 — two tiles, six columns each**

- `DSH-04` **Top vulnerable assets.** Horizontal `BarSeries`, top ten by asset risk rating, each bar labelled with hostname, rating, and known-exploited count. Selecting a bar opens that asset's detail. This is the tile a security lead screenshots for a meeting.
- `DSH-05` **Top CVEs by affected assets.** Horizontal `BarSeries`, top ten CVEs ranked by the number of affected assets, each row showing the CVE identifier in monospace, its CVSS with version, its known-exploited marker, and the asset count. Selecting a row filters Issues to that CVE across the estate. One fix, many hosts — this tile is where remediation efficiency is discovered.

**Row 4 — three tiles, four columns each**

- `DSH-06` **Exposure and criticality matrix.** `Matrix`, exposure on one axis (internet-facing, DMZ, internal, isolated) and asset criticality on the other, each cell holding the count of assets and using the risk ramp on the cell's highest asset rating. The internet-facing and critical cell is the corner an attacker looks at first, and so is the corner this dashboard is built around. Selecting a cell filters Assets.
- `DSH-07` **SLA compliance.** Single stacked horizontal `BarSeries`: within SLA, due within seven days, overdue. Plus a count of exceptions expiring in the next 30 days, which is the thing everyone forgets until it reopens. Drill-through per segment.
- `DSH-08` **Coverage and freshness.** Assets assessed against assets known, as a proportion bar; the count of detected services we could not map to a CPE, per `UI-117`; the age of the intelligence corpus in plain language; and the timestamp of the last completed scan per scope. This is the honesty tile: it tells the reader how much of the estate the numbers above actually describe.

## 5.2 Behaviour

- `DSH-09` A scope filter in the dashboard header applies to every tile simultaneously and is reflected in the URL. `UI-25`
- `DSH-10` All tiles share one data-as-of timestamp shown once in the header. Tiles must never display data from different moments without saying so.
- `DSH-11` Every tile links to a pre-filtered real screen, and the filter it applies is exactly the one the tile describes. A mismatch between a tile's number and its drill-through result destroys trust in every number on the page. Assert this correspondence with tests, tile by tile. `UI-76`
- `DSH-12` No tile auto-refreshes on a timer. A manual refresh control updates all tiles together, and a banner appears when a scan has completed since the page loaded.
- `DSH-13` Empty state before the first scan: a single instruction to declare a scope and run a scan, with the action attached. Not a grid of zeroes. `UI-77`
- `DSH-14` Partial state after one scan: tiles requiring a trend state that they need a second scan. They do not render a misleading single point.
- `DSH-15` A corpus update that changed issue bands surfaces here as a dismissible notice naming the count and linking to the delta, per `UI-108`. This is the dashboard's most valuable moment and it must not be silent.

## 5.3 Performance

- `DSH-16` Every dashboard figure reads from pre-computed aggregate tables, never from a live scan of the issues table. Aggregates are refreshed on scan completion, on corpus switch, on rescoring, and on issue state change, in a background job.
- `DSH-17` Dashboard p95 load at or below 500 ms against the `PERF-01` dataset, with all tiles rendered. Tiles render progressively as their data arrives rather than blocking on the slowest.
- `DSH-18` Aggregate staleness is bounded and visible: if an aggregate refresh is queued or failed, the header says so rather than showing a silently outdated number.

---

# 6. ACCEPTANCE

Extends the validation harness of the CVE intelligence specification.

- `ACC-10` After scanning the reference validation target with a clean database, the dashboard must show: exactly one asset; a non-zero known-exploited count matching the frozen baseline; a CVSS distribution weighted toward the upper bins with the version-mix indicator present, since that target's records are predominantly CVSS v2; the target as the sole entry in top vulnerable assets with a rating in the critical band; and the top-CVE tile containing the baseline backdoor CVEs. `ACC-03`
- `ACC-11` The asset's rating must be at or above 90 by the known-exploited floor of `SCORE-06`, and the asset detail must state that the floor applied and which issue triggered it.
- `ACC-12` Grouping must collapse the target's outdated packages into a number of remediation groups an analyst can read on one screen without scrolling more than twice, while the expanded atomic issue count matches the baseline exactly. Assert both numbers.
- `ACC-13` For every tile, assert that its displayed figure equals the row count of its own drill-through result. `DSH-11`
- `ACC-14` Assert scoring determinism: the same issue with the same inputs produces the same score across runs, and a documented change to any weight produces exactly the expected delta on a fixture set of twenty issues spanning all bands, all CVSS versions, and all confidence levels.
- `ACC-15` Assert the negative case on the dashboard: a freshly patched reference host produces a low asset rating, an empty known-exploited figure, and a CVSS distribution concentrated in the lower bins. A dashboard that looks alarming regardless of input is worthless. `ACC-06`
