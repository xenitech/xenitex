# `3.0` design-plan review, against §2

Per the build order: "if any element is what you would produce for any
admin panel rather than a choice made for this product, revise it and say
what changed and why." This is that review, done against the tokens
(`apps/web/src/design/tokens.css`/`tokens.ts`) and the three wireframes
(`wireframe-issues.md`, `wireframe-scan-review.md`, `wireframe-dashboard.md`).

## Genuine generic-admin-panel instincts caught and revised

**Colour-coding operational status (SLA/coverage/scan status) instead of
risk.** My first draft of the dashboard wireframe used the instinct any
admin dashboard reaches for automatically: green for "on time" and
"completed," amber for "approaching due," red for "overdue," a red/amber/green
gauge for coverage percentage. That's `UI-02` violated twice over —
saturated colour spent on things that are not risk, and a second colour
vocabulary competing with the risk ramp for the same visual channel `UI-09`
reserves for one place. Revised: scan status uses shape (`●` running, `✓`
completed), the coverage bar is a plain neutral fill, and the SLA tile
differentiates overdue from on-time by which number is stated first and in
heavier weight, not colour. The one place I kept the risk ramp outside the
Issues risk column is exceptions-approaching-expiry text, and only because
an expiring exception is arguably a risk-band-relevant fact, not an
operational-status one — **flagging this specific case for team review
rather than deciding it alone**, since `UI-18` (state colours reuse the risk
ramp) and `UI-09` (restraint — the risk column is the one bold place) can be
read as being in tension, and the spec doesn't fully resolve which wins for
a non-Issues-screen risk-adjacent fact.

**A generic "+ New" primary action on the Issues screen.** The archetype-A
template shows `title [ primary action ]`. My first instinct was to put
"New issue" or "New scan" there because that's what a list screen's top-right
corner holds in most admin panels. Neither makes sense for this product:
issues are system-detected, not created by a user, and "New scan" belongs to
the Scans screen, not Issues. Revised to "Export view" — genuinely the one
whole-view action an analyst or lead performs from this screen (handing a
filtered worklist to someone else), and it's the only button there, per
`UI-08`.

**Forcing a primary action onto the non-empty Dashboard.** Same template
reflex — a dashboard "should" have a top-right button (often "Customize" or
"Add widget" in a generic product). Per `UI-08`'s own logic ("if a screen
appears to have two, the IA is wrong") and the fact that a monitoring screen
whose only job is showing what the other five screens already contain
shouldn't compete with them for actions, I left it with none in the
populated state. The empty state is the one place Dashboard has exactly one
action ("Declare a scope and run a scan"), which is correct per `UI-77` and
doesn't contradict `UI-08` since it's a different state of the same screen.

**Three-column dashboard grid.** Default instinct for six tiles is a 3×2
grid. Tried it against the real "Top issues by risk" content (a CVE title
plus an inline risk explanation phrase) and it wrapped badly at three
columns wide. Two columns of three rows gives each tile enough width for a
real title and its explanation on one wrapped line, which is the whole
point of `UI-75`'s "explanation visible in the tile."

## Checked and compliant, not revised

- **`UI-04` density / no cards.** The Issues row needing two lines once real
  CVE titles were tried (`▊▊▊▊▊94 / Log4Shell RCE via JNDI lookup`, title on
  the line below the bar+score) is a multi-line _row_, not a card — radius
  stays 0 (`UI-28`), rows remain contiguous with hairline separators, no
  rounded boundary isolates one row from the next. Verified this reads as
  "record," not "card," in the ASCII layout by checking it against `UI-12`'s
  specific complaint (identical rounded cards chopping content into a grid)
  — there's no rounding and no gap between rows here.
- **`UI-52` chart types.** Risk posture uses a sparkline glyph (`▁▂▂▃▄▅…`),
  nothing else in either wireframe is a chart. No donut, no 3D, no
  dual-axis anywhere — checked because a generic dashboard almost always
  reaches for a donut for "coverage," which would have violated `UI-14`
  outright (and would've been a worse way to show 93% than a bar with the
  actual reason for the gap stated in text).
- **`UI-15` ordinal markers.** Used exactly once, in the scan wizard step
  indicator (`1 Scope ── 2 Profile ── 3 Schedule ── ● 4 Review`) — a genuine
  sequence, explicitly permitted. Not used anywhere in Issues or Dashboard.
- **`UI-08` one primary action, resolved case.** Scan review screen's
  primary action is unambiguous: `Start scan`, disabled until the plan
  finishes computing. `Cancel` is present but is an escape hatch, not a
  competing primary — this matches how `ConfirmDialog` tier 3 (§7) is meant
  to read.

## Open items for team review before `3.1`

1. **Risk-ramp reuse outside the Issues risk column** (exceptions-expiry
   text, described above) — needs an explicit team call, not a solo one,
   given `UI-18` and `UI-09` pull in different directions here.
2. **Confidence-in-row-vs-own-column** (Issues default view folds it into
   the asset cell; full nine-column view gives it a dedicated column) —
   I'm treating this as `UI-43` configurability rather than a contradiction
   of §6.1's column list, but that reading should be confirmed, not assumed,
   since §6.1 lists confidence as a peer column to state/age/SLA/owner and
   someone could reasonably read that as "always its own column."
3. **Font choices are provisional.** Tokens reference Inter, JetBrains Mono,
   and Vazirmatn (`tokens.css`) — Inter and JetBrains Mono are my picks from
   the suggested options (`UI-20`/`UI-21` say "suggested," not mandated);
   Vazirmatn is the spec's definite choice (`UI-22`) so that one isn't
   actually open. Actual self-hosted font packages are not wired in yet —
   that's `3.1` work, done once the component catalogue needs real
   rendering to test tabular-figure alignment (`UI-20`) and mixed-direction
   line-height (`UI-22`) against.
4. **The exceptions-expiry tile as the sixth dashboard tile** — `UI-75`
   names five tiles explicitly (risk posture, top issues, SLA, coverage,
   active/recent scans) and says "six tiles, no more" without naming the
   sixth. I used exceptions-approaching-expiry since `MOD-12` calls
   exceptions out as needing their own visibility and `6.4`'s tile list in
   the build prompt's Step 3 outline mentions it — but this is an inference
   from adjacent requirements, not a literal instruction, and is worth a
   one-line confirmation.

Per the closing instruction in `GATE 3` applied early: looking back at all
three wireframes for one thing to remove — the density toggle control shown
in the Issues header (`Density: ⊙ ○`) is worth cutting from the always-visible
header and moving into the column-configuration menu (`UI-43` already
covers per-view persistence); a toggle an analyst sets once per session
doesn't need permanent header real estate next to the saved-views control
they use constantly.
