# PANEL DESIGN SPECIFICATION

Companion to the lean MVP build prompt. This document replaces and expands **Step 3** of that plan. Requirement IDs from the build prompt are referenced throughout; new IDs in this document use the `UI-` prefix.

Read the build prompt first. Nothing here overrides a safety, security, or data requirement from it.

---

# 1. DESIGN BRIEF

**What this is.** An on-premise security console where a small team reviews what is wrong with their estate and decides what to fix first.

**Who uses it.** Three people, in descending order of hours spent in the product:

- The **analyst** lives here four hours a day, triaging issues. They are keyboard-driven, sceptical of tooling, and they will abandon the product the first time it wastes their time or presents a guess as a fact.
- The **security lead** visits twice a week to check posture, approve exceptions, and pull a report for management.
- The **operator** installs, configures, schedules scans, and is often not a security specialist at all.

**Primary job.** Move a person from *"something is wrong somewhere"* to *"this specific thing, on this specific host, is the one to fix today, and here is the proof"* in as few steps as possible.

**What the panel must never do.** Look impressive at the expense of being readable. Present an inference as a finding. Make a destructive action easy. Hide the evidence.

- `UI-01` Build with the product's real content throughout — real issue titles, real evidence text, real scanner output, real asset names. Lorem ipsum and placeholder counts produce layouts that break on contact with real data, and real data is what exposes a bad density decision.

---

# 2. DESIGN PRINCIPLES

These are specific to this product. Every visual decision must be traceable to one of them.

- `UI-02` **Saturated colour is reserved for risk.** Risk severity is the only thing on screen allowed a saturated hue. Navigation, buttons, charts, links, tags, and chrome are neutral or single-accent. If the interface is colourful, an analyst can no longer spot a critical issue from across the room, and colour has stopped being information.
- `UI-03` **Confidence is encoded without colour.** Confidence competes with risk for the same visual channel, so it gets a different one: a three-segment meter plus a word. This directly serves `MOD-20` — low-confidence inference must never look like proof.
- `UI-04` **Density is a feature.** The analyst is comparing dozens of rows. Whitespace that would be generous on a marketing page is hostile here. Default to a compact table, offer a comfortable mode, and never chop the list into cards.
- `UI-05` **Evidence is always one click away, never behind a modal.** Per `MOD-21`, an issue without inspectable evidence has no reason to be on screen. The evidence panel is part of the primary layout, not an afterthought.
- `UI-06` **Every ranking explains itself in place.** Per `MOD-17`, the risk score is never a bare number. Hovering or focusing it shows the contributing factors and weights without navigating away.
- `UI-07` **Dangerous actions are slow on purpose.** Starting a scan and stopping everything are the two moments where friction is correct. Everything else should be fast.
- `UI-08` **One primary action per screen.** If a screen appears to have two, the information architecture is wrong.
- `UI-09` **Restraint.** Spend visual boldness in exactly one place: the risk column. Everything else is quiet.

## 2.1 Explicitly forbidden treatments

- `UI-10` No gradient washes, no decorative glow, no glassmorphism, no coloured drop shadows.
- `UI-11` No tracked-out all-caps eyebrow labels above headings.
- `UI-12` No identical rounded cards chopping content into a grid, and no single border-radius applied to everything regardless of hierarchy.
- `UI-13` No arrow glyph appended to link and button text. No meta strings joined with middle dots.
- `UI-14` No donut or pie chart with more than three segments. No 3D chart of any kind. No dual-axis chart.
- `UI-15` No numbered markers (01 / 02 / 03) except where the content genuinely is an ordered sequence — the setup wizard and the scan pipeline view qualify; nothing else does.
- `UI-16` No entrance animation on lists, tables, or sections. Motion only answers a user action.

---

# 3. DESIGN TOKENS

Define these once in a single tokens file consumed by both themes. No component may introduce a raw hex value.

## 3.1 Colour

**Neutral base — cool, low chroma, so risk colour stands apart.**

Light theme:
```
surface            #FAFAFB
surface-sunken     #F2F3F5
surface-raised     #FFFFFF
border             #DDDFE3
border-strong      #C2C6CC
ink                #1A1D21
ink-muted          #5A6069
ink-subtle         #868D95
```

Dark theme — the analyst's default, because this product is often open on a wall display or in a dim room:
```
surface            #14171A
surface-sunken     #0F1214
surface-raised     #1C2024
border             #2A2F35
border-strong      #3B424A
ink                #E6E8EA
ink-muted          #9AA1A9
ink-subtle         #6C747D
```

**Interactive accent — one hue, deliberately desaturated so it never competes with risk.**
```
accent             #2D6E8E
accent-hover       #255C78
accent-subtle      #E8F1F5   (light)  /  #17303C (dark)
```

**Risk ramp — five bands, ordered by luminance as well as hue so severity survives greyscale and colour-vision deficiency.**
```
risk-critical      #9B1C1C
risk-high          #C4571F
risk-medium        #B8862B
risk-low           #4A7C59
risk-info          #5A6069
```

- `UI-17` Every risk indicator pairs the colour with a text label and a fixed-position ordinal bar. Colour alone never carries severity. `QA-06`
- `UI-18` State colours reuse the risk ramp rather than introducing a second palette: failure uses `risk-critical`, warning uses `risk-medium`, success uses `risk-low`. A security console does not need a separate green for "saved".
- `UI-19` Both themes meet WCAG 2.2 AA contrast for text and for non-text UI components. Verify the risk ramp against both surfaces; adjust the token, never the usage.

## 3.2 Typography

- `UI-20` One UI family with true tabular figures. Suggested: Inter or IBM Plex Sans. Tabular figures are non-negotiable — CVSS scores, ports, and counts appear in columns and must align.
- `UI-21` One monospace family, used **only** for machine output: evidence blocks, raw scanner excerpts, CPE strings, certificate fields, log lines. Monospace is content-driven here, not a stylistic label treatment. Suggested: IBM Plex Mono or JetBrains Mono.
- `UI-22` Persian uses a metrically compatible family — Vazirmatn is the practical choice — paired so that a mixed English/Persian row does not change line height.
- `UI-23` All fonts self-hosted and shipped in the offline bundle. No external font request exists in the built output; CI asserts this. `P1-26`
- `UI-24` Type scale, in rem: 0.75 / 0.8125 / 0.875 / 1 / 1.125 / 1.375 / 1.75. Body is 0.875 in dense views, 1 in prose views. Do not introduce sizes outside the scale.
- `UI-25` Two weights in UI chrome: regular and medium. Semibold only for page titles and the risk value. No light weights — they fail on dark backgrounds at small sizes.
- `UI-26` Prose regions — issue descriptions, remediation guidance, report bodies — cap at 72 characters per line. Table cells are exempt.

## 3.3 Spacing, radius, elevation

- `UI-27` Spacing scale in px: 2, 4, 6, 8, 12, 16, 24, 32, 48. Nothing else.
- `UI-28` Radius is hierarchical, not uniform: 0 on table cells and data rows, 4 on inputs, buttons, and tags, 8 on panels and dialogs. Zero radius on data rows is deliberate — it signals "this is a record, not a card". `UI-12`
- `UI-29` Two elevation levels only: a border for resting surfaces, and one soft shadow for overlays (dialogs, popovers, the command palette). No shadow on resting content.
- `UI-30` Row heights: compact 32px, comfortable 40px. Compact is the default on Issues, Assets, Observations, and Audit.

## 3.4 Motion

- `UI-31` Two durations: 120ms for state change, 200ms for overlay entry and exit. One easing curve. Nothing longer.
- `UI-32` Motion answers an action — a panel opening, a row expanding, a confirmation landing. Nothing animates on page load. `UI-16`
- `UI-33` `prefers-reduced-motion` removes all transitions except opacity.

---

# 4. LAYOUT AND NAVIGATION

## 4.1 Application shell

```
┌──────────┬──────────────────────────────────────────────────────────┐
│          │  context bar: scope · data age · health · stop · account │
│  left    ├──────────────────────────────────────────────────────────┤
│  rail    │                                                          │
│          │                     main region                          │
│          │                                                          │
└──────────┴──────────────────────────────────────────────────────────┘
```

- `UI-34` Left rail, 224px expanded and 56px collapsed, holding exactly six destinations: Dashboard, Issues, Assets, Scans, Reports, Settings. One level of nesting maximum, and only inside Settings. If a seventh destination is proposed, something else is in the wrong place.
- `UI-35` The context bar is persistent and carries four things that must never be more than one glance away: the active scope filter, the vulnerability-data age (`P2-08`), the system health indicator (`OPS-04`), and the global stop control (`SAFE-07`). Account menu sits at the far end.
- `UI-36` The health indicator and the data-age indicator are always visible, never collapsed into a menu. A stale-data warning is shown as text, not as a coloured dot alone.
- `UI-37` No breadcrumb trail. Navigation is two levels deep at most, so breadcrumbs would be decoration.

## 4.2 The two layout archetypes

Every screen in the product uses one of these. There is no third.

**Archetype A — list-detail split.** Used by Issues, Assets, Scans, Audit, and Observations.

```
┌─────────────────────────────────────────────────────────────────────┐
│ title                                          [ primary action ]   │
├─────────────────────────────────────────────────────────────────────┤
│ saved views ▸  filter chips                          density ⇅      │
├───────────────────────────────────┬─────────────────────────────────┤
│ ▸ virtualised table                │  detail panel                  │
│   risk │ issue │ asset │ conf │ …  │  ┌───────────────────────────┐ │
│   ███  │ ...   │ ...   │ ▮▮▯  │    │  │ overview │ evidence │ log │ │
│   ███  │ ...   │ ...   │ ▮▮▮  │    │  └───────────────────────────┘ │
│   ██   │ ...   │ ...   │ ▮▯▯  │    │                                │
│                                    │  [ state actions ]             │
└───────────────────────────────────┴─────────────────────────────────┘
        ~60%                                    ~40%
```

- `UI-38` The detail panel is inline, resizable, and collapsible — never a modal. An analyst compares rows while reading a detail; a modal makes that impossible. `UI-05`
- `UI-39` Arrow keys move the row selection and the detail panel follows. This is the single most-used interaction in the product; it must be instant against the `PERF-01` dataset.
- `UI-40` Selection survives filtering where the row still matches, and the URL always reflects the selected record. `P1-25`

**Archetype B — single column, max 960px.** Used by Dashboard, Reports, Settings, and the setup wizard.

- `UI-41` Configuration screens use a left-aligned label-above-field form, one column, grouped by section with a plain heading. No two-column forms, no floating labels, no inline-editable settings.

## 4.3 Density and responsiveness

- `UI-42` Design for 1440px. Support down to 1024px by collapsing the detail panel to an overlay. Below 1024px, provide a read-only reduced view — this is a desktop operations console and we do not pretend otherwise, but a lead checking posture on a tablet must not hit a broken layout.
- `UI-43` Table columns are user-configurable — visibility and order — persisted per user, per screen. Saved views capture column configuration along with filters.

---

# 5. COMPONENT INVENTORY

Build these as a documented catalogue **before** building any screen, with visual regression tests on each. `P1-27`

**Data display**
- `UI-44` `RiskBadge` — ordinal bar, numeric score, band label. Focusable; on focus or hover reveals `RiskExplainer`.
- `UI-45` `RiskExplainer` — popover listing each contributing factor, its input value, its weight, and the resulting contribution, plus the scoring-function version. Satisfies `MOD-17`.
- `UI-46` `ConfidenceMeter` — three segments plus a word: inferred, corroborated, verified. Never coloured. Satisfies `MOD-19` and `MOD-20`.
- `UI-47` `EvidenceBlock` — monospace, line-numbered, with the matched span highlighted, the source adapter and timestamp, and a link to the raw artifact. **All content escaped and rendered as text, never as markup** — this is the `SEC-17` surface and the most likely injection point in the whole product.
- `UI-48` `DataTable` — virtualised, keyboard-navigable, multi-select, configurable columns, sticky header, per-column sort, cursor pagination with an infinite-scroll option, and a visible total count that is honest about being approximate when it is.
- `UI-49` `StateChip` — issue lifecycle state, using shape and label rather than colour alone.
- `UI-50` `AssetIdentityList` — identity keys with their source and confidence, making `MOD-05` legible to a human who needs to judge whether a merge was right.
- `UI-51` `Timeline` — issue history, scan run progress, exception lifecycle. Ordinal markers are permitted here per `UI-15`.
- `UI-52` `Sparkline` and `BarSeries` — the only two chart types in the product. If a third is proposed, the data probably belongs in a table.

**Input and control**
- `UI-53` `FilterBar` — facet chips with counts, a free-text query, and save-as-view. Filters compose; the URL always mirrors them.
- `UI-54` `SavedViews` — user and shared views, with an indicator when the current filter set diverges from the saved one.
- `UI-55` `ScopePicker` — selects from `authorized_scope` records only. It is not possible to type an arbitrary target anywhere in this interface. `SAFE-01`
- `UI-56` `ProfileSelector` — shows intrusiveness class with a one-line plain-language consequence for each.
- `UI-57` `ConfirmDialog` — three escalation tiers described in §7.
- `UI-58` `CommandPalette` — keyboard entry to every screen, every saved view, and every global action.

**Feedback**
- `UI-59` `EmptyState` — explains what the screen holds and offers the one action that populates it. Never a decorative illustration. `UI-77`
- `UI-60` `ErrorState` — renders the RFC 9457 problem detail: what happened, the machine-readable code, what to do next, and a correlation identifier the operator can quote in a support conversation. `P1-04`
- `UI-61` `PermissionDenied` — names the permission required and who can grant it. Never a bare "access denied".
- `UI-62` `JobProgress` — for scans and report generation: per-stage progress, current target, elapsed and estimated remaining, and pause and abort where permitted.
- `UI-63` `SkeletonRow` — used only in the table body. Never a full-page skeleton; the shell renders immediately.

---

# 6. SCREEN SPECIFICATIONS

Screens are built in this order. The Issues screen is first because it is where the product succeeds or fails, and because building the dashboard before it produces tiles that measure nothing.

## 6.1 Issues — the primary surface

Archetype A. Default filter: open states, risk band medium and above, confidence at or above corroborated.

**Table columns, left to right:** risk, issue title, asset, service and port, confidence, state, age, SLA, owner.

- `UI-64` The risk column is the widest non-text column and the only saturated element in the row. `UI-02`
- `UI-65` Row hover reveals no actions. Actions live in the detail panel and in the bulk toolbar. Hover-revealed controls are undiscoverable and slow.
- `UI-66` Multi-select enables a bulk toolbar: assign owner, set state, mark false positive, request exception, export. Bulk state changes require the same justification as single changes — no bulk path may bypass `MOD-11` or `MOD-12`.

**Detail panel, four tabs:**
1. *Overview* — title, plain-language description, affected asset with its criticality and exposure, risk explanation inline, remediation guidance from `EXT-03`, owner, SLA.
2. *Evidence* — one `EvidenceBlock` per contributing observation, newest first, each with adapter, version, run, and raw-artifact link. `MOD-21`
3. *History* — state transitions with actor and justification, verification results, reopen events.
4. *Related* — other issues on the same asset, and the same issue on other assets, with a one-click filter to either.

- `UI-67` State actions sit at the panel foot, always in the same position, with the destructive-adjacent ones (false positive, risk acceptance) visually separated from the routine ones.
- `UI-68` Requesting a risk acceptance opens a form requiring justification and expiry, and shows who will be asked to approve. The approver field makes `MOD-12` separation of duties visible before submission, not as an error afterwards.

## 6.2 Assets

Archetype A. Columns: asset name, addresses, OS, criticality, exposure, open issues by band, fragile flag, last seen.

- `UI-69` The fragile flag is shown as a labelled marker in the row, not a tooltip. An operator must see at a glance which assets are being handled gently and why. `SAFE-05`
- `UI-70` Detail tabs: overview, identity (`UI-50`), services, issues, scan history, tags and ownership.
- `UI-71` The identity tab exposes merge candidates and the split control, with the precedence rule that produced the merge stated in plain language. This is where an analyst decides whether to trust our asset model at all. `MOD-06`

## 6.3 Scans

Archetype A for history, Archetype B for the creation wizard.

**Creation wizard, four steps** — ordinal markers permitted, this is a genuine sequence:
1. Scope — `ScopePicker`, authorised records only.
2. Profile — intrusiveness class with plain-language consequences.
3. Schedule — now, once, or recurring, with blackout windows shown inline.
4. **Review** — the `SAFE-08` pre-flight plan.

- `UI-72` The review step is the most carefully designed screen in the product. It shows: target count, estimated packet volume, estimated duration, the full list of excluded targets with the rule that excluded each, every fragile-asset downgrade, the pacing ceilings in effect, and the profile. The confirm control is disabled until the plan has been rendered in full — never optimistically enabled while the estimate is still computing.
- `UI-73` Live run view: per-stage pipeline progress, current targets, throughput against the pacing ceiling, per-target status including excluded and downgraded, and pause and abort. Excluded targets are listed, not silently absent — an operator must be able to verify that the exclusion did what they intended. `SAFE-02`
- `UI-74` Run detail retains the raw artifact download and the adapter versions used, so any finding can be traced back to the bytes that produced it. `PRIN-02` of the build prompt.

## 6.4 Dashboard

Archetype B. Built last. Six tiles, no more.

- `UI-75` Tiles: risk posture over time; top issues by risk, with the explanation visible in the tile rather than requiring navigation; SLA compliance with overdue count; coverage, meaning assets assessed against assets known, which is the honest measure of whether the product is actually looking at the estate; active and recent scans; exceptions approaching expiry.
- `UI-76` Every tile links to a pre-filtered view of a real screen. A tile that cannot link to a filtered view is a vanity metric and is removed.
- `UI-77` The empty dashboard, before a first scan, is a direct instruction to declare a scope and run one — a single action, not a grid of zeroes.

## 6.5 Reports

Archetype B. Three templates: executive summary, technical detail, delta between two dates.

- `UI-78` Generation is a job. The screen shows queue position and progress, and the result list retains generation time, scope, data versions, and scoring-function version, so a reader can tell whether two reports are comparable. `P2-19`
- `UI-79` Output formats are HTML with a print stylesheet, CSV, and JSON. The HTML report uses the same tokens as the panel and must print correctly to A4 and Letter with page breaks that do not split an issue block.

## 6.6 Settings and administration

Archetype B. Sections: scopes and exclusions, profiles and schedules, users and roles, notification channels, retention, backup, offline updates, feature flags, licence.

- `UI-80` Declaring a scope requires typing the attestation of authority. It is not a checkbox. This is the legal boundary of the entire product and the interface must make that felt. `SAFE-01`
- `UI-81` Exclusion rules display which scopes they affect and how many targets they currently exclude, computed at display time. An exclusion rule whose effect is invisible will be written wrong.
- `UI-82` Only four roles exist in this release — viewer, analyst, operator, administrator — presented as a plain permission table, not a matrix builder. `A.4`

## 6.7 Audit

Archetype A. Columns: timestamp, actor, action, target, outcome.

- `UI-83` A persistent chain-verification indicator states when the log was last verified and whether it passed. If verification fails, this becomes the most prominent element on the screen and an alert fires. `DATA-02`
- `UI-84` Before-and-after state for mutations is shown as a readable diff, not as raw JSON. `DATA-03`

## 6.8 Setup wizard and System Health

- `UI-85` The setup wizard is the first impression and the only screen a customer sees before deciding whether we are competent. Steps: administrator account, organisation and timezone, TLS, first authorised scope with attestation, safety defaults review, acknowledgement. It ends by offering the first scan, pre-filled — not by dropping the operator onto an empty dashboard.
- `UI-86` System Health is written for a non-engineer operator. Each component states what it does in plain language, its status, and what to do if it is unhealthy, linking to the relevant runbook. No raw metric names, no percentages without units. `OPS-04`

---

# 7. SAFETY-CRITICAL INTERFACE PATTERNS

These four patterns carry the product's safety guarantees. Design them first and review them as a team.

- `UI-87` **Three confirmation tiers.** Tier 1, routine — a button with no dialog. Tier 2, consequential (starting a scan, approving an exception, deleting a saved view) — a dialog summarising exactly what will happen, with the primary action labelled with the verb, never "OK". Tier 3, serious (confirming a `standard`-profile scan, global stop, deleting a scope) — a dialog requiring the user to type a specific word, with a plain-language statement of the consequence.
- `UI-88` **Global stop.** Present in the context bar on every screen. Tier 3 confirmation. After invocation the entire panel enters a visibly stopped state with a persistent banner naming who stopped it and when, and no scan can be started until it is explicitly cleared. The banner also states that the CLI equivalent exists, so an operator facing a degraded panel knows there is another path. `SAFE-07`
- `UI-89` **Scope boundary made visible.** Anywhere a target could conceptually be entered, the interface offers a selection from authorised scopes instead. There is no free-text target field in this product. If a user needs a target we have no scope for, the interface routes them to the scope declaration flow with its attestation. `SAFE-01`
- `UI-90` **Honest uncertainty.** Wherever a number is an estimate, it is labelled as one. Wherever a finding rests on inference, `ConfidenceMeter` says so in the row, not only in the detail. Wherever vulnerability data is stale enough to affect a result, the affected view carries a plain-language notice. The product's credibility rests on never being confidently wrong. `QA-00`

---

# 8. KEYBOARD, ACCESSIBILITY, AND RTL

- `UI-91` Keyboard shortcuts: `g` then `i/a/s/r/d` to navigate; `j`/`k` row movement; `Enter` open detail; `e` evidence tab; `x` select row; `f` focus filter; `/` search; `⌘K` command palette; `?` shortcut help; `Esc` close overlay. Every shortcut is discoverable from the help overlay, and none is the only way to do something.
- `UI-92` Full keyboard operability with a visible focus ring on every interactive element. The focus ring uses a token, not the browser default, and is verified against both themes.
- `UI-93` Screen-reader support on the virtualised table: correct row and column semantics, announced sort and filter changes, and a live region for job progress. Virtualisation must not break the accessibility tree — verify with an actual screen reader, not only with an automated checker. `QA-06`
- `UI-94` RTL is a layout mirror, not a text-direction switch. Mirror the rail, table column order, panel side, progress direction, and icon direction. Do **not** mirror: monospace evidence blocks, IP addresses, CVE identifiers, CPE strings, version numbers, or charts with a time axis. Those are logically left-to-right in every locale and mirroring them is an error. `P1-20`
- `UI-95` Mixed-direction content — a Persian description containing an English CVE identifier — must render with correct bidirectional isolation. Build a test fixture of the twenty worst mixed-direction strings in the product and keep it as a visual regression test.
- `UI-96` Dates, numbers, and durations are locale-formatted; digits follow the user's locale preference with an explicit setting, because Persian users differ on Latin versus Persian numerals and guessing wrong is worse than asking.

---

# 9. WRITING IN THE INTERFACE

- `UI-97` Name things as the user understands them, not as the system implements them. "Scan schedule", not "cron job". "Evidence", not "observation payload". The domain model is internal vocabulary; the interface has its own.
- `UI-98` Buttons name the action's outcome, and the name persists through the flow: the button says "Start scan", the toast says "Scan started", the history row says "Scan started". Never "Submit", never "OK".
- `UI-99` Errors state what happened and what to do, in the interface's voice. They do not apologise and they are never vague. "The scan could not start because the scope was changed while you were reviewing the plan. Review the updated plan and confirm again." — not "An error occurred."
- `UI-100` Empty states are an invitation to act, with the one relevant action attached.
- `UI-101` Sentence case everywhere. No filler. One job per string.
- `UI-102` All copy is externalised for translation from the first commit, with context notes for translators. Persian copy is reviewed by a native security practitioner, not machine-translated — an interface that says the wrong thing about risk in the user's own language is worse than one in English.

---

# 10. CAPABILITY COVERAGE MATRIX

This is how "the panel matches the product" is verified rather than asserted. Every capability in the build prompt maps to a surface and a component. A capability with no row here is either not built or not reachable, and both are defects.

| Capability | Requirement | Screen | Primary component |
|---|---|---|---|
| Asset discovery results | `MOD-01` | Assets | `DataTable` |
| Asset identity, merge, split | `MOD-05` `MOD-06` | Assets → Identity | `AssetIdentityList` |
| Address history across DHCP churn | `MOD-07` | Assets → Overview | `Timeline` |
| Vulnerability catalogue reference | `MOD-02` | Issues → Overview | detail panel |
| Raw observations and artifacts | `MOD-03` | Issues → Evidence; Scans → Run detail | `EvidenceBlock` |
| Deduplicated issues | `MOD-04` `MOD-08` `MOD-09` | Issues | `DataTable` |
| Issue lifecycle | `MOD-10`–`MOD-13` | Issues → detail foot | `StateChip`, state actions |
| False positive handling | `MOD-11` | Issues → detail foot | `ConfirmDialog` tier 2 |
| Risk acceptance with expiry | `MOD-12` | Issues; Settings → Exceptions | exception form, `Timeline` |
| SLA tracking | `MOD-14` | Issues; Dashboard | SLA column, SLA tile |
| Risk scoring | `MOD-15` `MOD-16` | Issues | `RiskBadge` |
| Risk explainability | `MOD-17` | Issues, Dashboard | `RiskExplainer` |
| Confidence | `MOD-19` `MOD-20` | Issues | `ConfidenceMeter` |
| Evidence retention | `MOD-21` | Issues → Evidence | `EvidenceBlock` |
| Scope authorisation | `SAFE-01` | Settings → Scopes; Scan wizard | attestation form, `ScopePicker` |
| Exclusion registry | `SAFE-02` | Settings → Exclusions; Scan review; Run view | exclusion list |
| Intrusiveness profiles | `SAFE-03` | Scan wizard | `ProfileSelector` |
| Pacing ceilings | `SAFE-04` | Settings → Profiles; Run view | throughput readout |
| Fragile-device handling | `SAFE-05` | Assets; Scan review; Run view | fragile marker |
| Blackout windows | `SAFE-06` | Settings → Schedules; Scan wizard | schedule editor |
| Global stop | `SAFE-07` | Context bar, every screen | tier 3 `ConfirmDialog` |
| Pre-flight plan | `SAFE-08` | Scan wizard step 4 | review screen |
| Verification scans | Step 4.6 | Issues → History; Scans | `Timeline`, `JobProgress` |
| Remediation guidance | `EXT-03` | Issues → Overview; Reports | guidance block, worklist export |
| Reports | `P2-19` | Reports | template picker, `JobProgress` |
| Notifications | `P2-20` | Settings → Notifications | channel editor |
| Audit log and chain verification | `DATA-02` `DATA-03` | Audit | `DataTable`, verification indicator |
| Retention policy | `DATA-04` | Settings → Retention | form |
| Backup status | `DATA-05` | Settings → Backup; System Health | status panel |
| Vulnerability data age | `P2-08` | Context bar; System Health | data-age indicator |
| System health | `OPS-04` | System Health | status panel |
| Offline update import | Step 5.2 | Settings → Updates | manifest diff view |
| Authentication and MFA | `SEC-07`–`SEC-09` | Sign in; Settings → Users | auth screens |
| Roles and permissions | `UI-82` | Settings → Users | permission table |
| First-run configuration | `UI-85` | Setup wizard | wizard |

---

# 11. BUILD ORDER FOR STEP 3

Work in two passes as the design process requires: plan, review the plan against this brief, then build.

**3.0 — Design plan (2 days).** Produce the token set, the type scale, and ASCII wireframes for the Issues screen, the scan review screen, and the dashboard. Review each against §2: if any element is what you would produce for any admin panel rather than a choice made for this product, revise it and say what changed and why. Do not start coding until this passes.

**3.1 — Token and component catalogue (4 days).** Build every component in §5 in isolation, in both themes, both densities, both directions, with visual regression tests. Screens assembled from an incomplete catalogue get one-off components that drift.

**3.2 — Issues screen (5 days).** The whole archetype A pattern proves itself here: virtualised table at `PERF-01` volume, detail panel, evidence, risk explainer, bulk actions, saved views, keyboard navigation.

**3.3 — Assets and Scans (5 days).** Reuse archetype A. Build the scan wizard, and give the review step of `UI-72` its own review.

**3.4 — Safety patterns (2 days).** The four patterns in §7, wired across every screen.

**3.5 — Settings, Audit, System Health, setup wizard (4 days).** Archetype B throughout.

**3.6 — Dashboard (2 days).** Built last, from what the other screens actually contain.

**3.7 — Reports and print (2 days).** Including the A4 and Letter print pass.

**GATE 3 — panel complete.** Every row of the §10 coverage matrix is reachable in the running panel against mocks. Every screen has designed loading, empty, error, and permission-denied states. Accessibility and RTL passes complete, including the mixed-direction fixture and a real screen-reader session. The `PERF-01` fixture renders, filters, and keyboard-navigates within budget. Three reviewers — at least one a practising security operator rather than an engineer — complete a scripted walkthrough ending in "which issue would you fix first, and how do you know", and their findings are triaged. Finally, apply the last rule: look at each screen and remove one thing. `UI-09`
