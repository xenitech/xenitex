# Wireframe — Issues (Archetype A)

Part of `3.0` (design plan). Built with realistic content per `UI-01`: real
CVE IDs, real-shaped hostnames, real evidence excerpts — not lorem ipsum,
not "Issue 1". Row heights, column widths, and truncation decisions below
are what they are _because_ real content was used to test them.

## Default state — list-detail split, ~60/40

```
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│ Issues                                                          [ Export view ]           │
├──────────────────────────────────────────────────────────────────────────────────────────┤
│ Saved views ▸ All open (default)   Filters: risk ≥ medium · confidence ≥ corroborated  ×2 │
├────────────────────────────────────────────────┬─────────────────────────────────────────┤
│ risk  issue                        asset        │ Log4Shell RCE via JNDI lookup           │
│                                     conf state   ├─────────────────────────────────────────┤
│ ▊▊▊▊▊ Log4Shell RCE via JNDI       api-gateway-  │ Overview │ Evidence │ History │ Related │
│  94    lookup                     01.dmz    ▮▮▮  ├─────────────────────────────────────────┤
│        CVE-2021-44228             corrob. new    │                                         │
│────────────────────────────────────────────────│  A crafted request to the logging         │
│ ▊▊▊▊  OpenSSH agent forwarding    jenkins.corp.  │  pipeline can trigger remote code         │
│  81    RCE                        example    ▮▮▯ │  execution via a malicious JNDI lookup.   │
│        CVE-2023-38408             corrob. triaged│                                         │
│────────────────────────────────────────────────│  Affected asset                          │
│ ▊▊▊▊  F5 BIG-IP iControl REST     vpn-gw-01.dmz  │  api-gateway-01.dmz                       │
│  78    auth bypass                          ▮▮▯  │  Criticality: high · Exposure: external  │
│        CVE-2022-1388              corrob. new    │                                         │
│────────────────────────────────────────────────│  Risk score                    [ 94 ]▾   │
│ ▊▊▊   Self-signed TLS certificate db-prod-03.    │   ┌─────────────────────────────────┐   │
│  56                                internal  ▮▯▯ │   │ Known-exploited (CISA KEV)  +30  │   │
│        no CVE — configuration     infer. new     │   │ Exploit probability (0.94)  +28  │   │
│────────────────────────────────────────────────│   │ CVSS base (10.0)             +15  │   │
│ ▊▊▊   Anonymous FTP login enabled fileserver-02. │   │ Exposure: external           +15  │   │
│  53                                internal  ▮▮▯ │   │ Asset criticality: high       +8  │   │
│        no CVE — exposure          corrob. mitig. │   │ Confidence × 0.94                │   │
│────────────────────────────────────────────────│   │ Scoring function v1               │   │
│ ▊▊    EternalBlue SMB remote code db-legacy-01.  │   └─────────────────────────────────┘   │
│  41    execution                  internal   ▮▯▯ │  Remediation                             │
│        CVE-2017-0144              infer. reopened│  Apply the vendor patch for the JNDI      │
│                                                  │  lookup class, or disable message        │
│  [ 6 of 214 shown — jk to move, Enter to open ]  │  substitution if patching is not yet      │
│                                                  │  possible.                               │
│                                                  │                                         │
│                                                  │  Owner: unassigned    Due: 2 days        │
│                                                  ├─────────────────────────────────────────┤
│                                                  │ [ Mitigated ]  [ Verify fix ]            │
│                                                  │        [ False positive ] [ Risk accept] │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

## Full column set (detail panel collapsed, or wide viewport)

§6.1 names nine columns: risk, issue title, asset, service and port,
confidence, state, age, SLA, owner. The list-detail view above shows fewer
than nine at once by default — that's `UI-43` (columns are user-configurable,
visibility and order, saved per view), not a silent drop of the requirement.
With the detail panel collapsed, all nine fit:

```
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│ risk    issue                          asset              svc/port  conf     state    age  SLA  owner │
├──────────────────────────────────────────────────────────────────────────────────────────────────┤
│ ▊▊▊▊▊94 Log4Shell RCE via JNDI lookup  api-gateway-01.dmz  443/tcp  ▮▮▮ corr  new       2h  2d  —      │
│ ▊▊▊▊ 81 OpenSSH agent forwarding RCE   jenkins.corp.exam.. 22/tcp   ▮▮▯ corr  triaged   1d  5d  R.Nazari│
│ ▊▊▊▊ 78 F5 BIG-IP iControl REST byp.   vpn-gw-01.dmz       443/tcp  ▮▮▯ corr  new       3h  1d  —      │
│ ▊▊▊  56 Self-signed TLS certificate    db-prod-03.internal 5432/tcp ▮▯▯ infer new       6d  30d —      │
│ ▊▊▊  53 Anonymous FTP login enabled    fileserver-02.inte.. 21/tcp  ▮▮▯ corr  mitig.   12d  30d M.Karimi│
│ ▊▊   41 EternalBlue SMB remote code    db-legacy-01.intern. 445/tcp ▮▯▯ infer reopened 20d  7d  —      │
└──────────────────────────────────────────────────────────────────────────────────────────────────┘
```

The default list-detail view keeps confidence folded into the asset cell
(as shown above) specifically because `service/port`, `age`, `SLA`, and
`owner` matter less during active row-by-row triage than during a "scan the
whole list" pass with the panel closed — the same table, two configurations
of the same nine columns, not two different tables.

Row density (compact/comfortable, `UI-30`) is set from the column
configuration menu, not a permanent control in the header (see
`docs/design/review.md`'s closing "remove one thing" pass) — it's a
once-per-session choice and doesn't earn header real estate next to the
saved-views control an analyst touches constantly.

## Notes on decisions this content exposed

- **The risk column needed two lines, not one** (bar + score, then title
  wrapping to a second line under it) once real CVE titles were tried —
  "OpenSSH agent forwarding RCE" and "F5 BIG-IP iControl REST auth bypass"
  do not fit one line at compact density without truncating the part that
  actually identifies the vulnerability. Truncating the CVE ID instead of
  the title was rejected: the CVE ID is what an analyst searches for later.
- **Confidence meter (`▮▮▮`/`▮▮▯`/`▮▯▯`) sits directly under the asset name in
  the row**, not in its own column, once six real rows were laid out —
  giving confidence a full column pushed the table past 1440px with every
  other column at a legible width. This still satisfies `UI-90` (confidence
  visible in the row, not only in detail) without a ninth column competing
  for space against `owner`/`SLA`, which matter more to daily triage.
- **The configuration-only rows (self-signed cert, anonymous FTP) read
  correctly with no CVE** — "no CVE — configuration" / "no CVE — exposure"
  in the position the CVE ID normally occupies, rather than a blank cell.
  A blank cell there would read as a data-loading bug, not as "this issue
  legitimately has no CVE" (`MOD-04`).
- **Risk explainer (`UI-45`) shown expanded in the overview tab**, not only
  on hover of the badge — the walkthrough test in `GATE 3` asks reviewers
  "which issue would you fix first, and how do you know," and the answer
  has to be visible the instant the detail panel opens, not one more
  interaction away.

## Empty state (before any scan has run)

```
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│ Issues                                                                                     │
├──────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                             │
│                    No scope has been authorised yet.                                       │
│                    Issues appear here once a scan runs against an authorised scope.        │
│                                                                                             │
│                    [ Declare a scope ]                                                     │
│                                                                                             │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

This is the same empty-state pattern as the dashboard (`UI-77`) — a single
action, not a grid of zeroes, and it names the actual reason the list is
empty rather than a generic "no results."
