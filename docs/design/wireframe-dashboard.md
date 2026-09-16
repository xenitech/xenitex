# Wireframe — Dashboard (Archetype B, six tiles)

Built last per the build order (`3.6`), but wireframed now against realistic
tile content so the token/density decisions above hold up here too. Every
tile links to a pre-filtered real screen (`UI-76`) — none of these numbers
exist only on this screen.

```
┌────────────────────────────────────────────────────────────────────────────────┐
│  Dashboard                                                    Production · 4,096 assets │
├──────────────────────────────────┬───────────────────────────────────────────────┤
│ Risk posture, 90 days             │ Top issues by risk                            │
│                                    │                                                │
│  ▁▂▂▃▄▅▅▆▇▇▆▅▄▃▃▂▂▁▁▂▂▃▄▅         │ 94  Log4Shell RCE via JNDI lookup             │
│  Open risk-weighted score: 2,340   │     api-gateway-01.dmz · known-exploited,     │
│  ▾ 8% vs last week                 │     external, critical asset                  │
│                                    │ 81  OpenSSH agent forwarding RCE              │
│  [ View trend detail → Issues ]    │     jenkins.corp.example · exploit prob. 0.71 │
│                                    │ 78  F5 BIG-IP iControl REST auth bypass       │
│                                    │     vpn-gw-01.dmz · known-exploited, external │
│                                    │                                                │
│                                    │ [ View all open issues by risk → Issues ]     │
├──────────────────────────────────┼───────────────────────────────────────────────┤
│ SLA compliance                    │ Coverage                                      │
│                                    │                                                │
│  On time        187  (87%)        │  3,812 of 4,096 known assets assessed         │
│  Overdue          9                │  in the last 30 days                          │
│  Approaching due 18                │  ▊▊▊▊▊▊▊▊▊▊▊▊▊▊▊▊▊▊▊▊▊▊▊▊▊▊▊▊▊▊▊▊▊▊▊▊▊▊░░░  93%│
│                                    │  284 not assessed — mostly the payroll and    │
│  [ View overdue → Issues ]         │  HR segments, which are excluded from scope   │
│                                    │  [ View unassessed → Assets ]                 │
├──────────────────────────────────┼───────────────────────────────────────────────┤
│ Active and recent scans           │ Exceptions approaching expiry                 │
│                                    │                                                │
│  ● Running — Production network    │  Self-signed cert on legacy-crm.internal      │
│    41% · 1,680 of 4,096 targets    │  Expires in 4 days · approved by S. Vahidi    │
│  ✓ Completed 3h ago — DMZ scope    │                                                │
│  ✓ Completed 1d ago — Production   │  Anonymous FTP on archive-02.internal         │
│                                    │  Expires in 11 days · approved by S. Vahidi   │
│  [ View scan history → Scans ]     │  [ View exceptions register → Settings ]      │
└──────────────────────────────────┴───────────────────────────────────────────────┘
```

## Decisions this content exposed

- **"Top issues by risk" shows the explanation inline as a short phrase**
  ("known-exploited, external, critical asset"), not the full `RiskExplainer`
  breakdown — the full factor/weight table (`UI-45`) belongs in the Issues
  detail panel where there's room; on a dashboard tile competing for space
  with five others, the compressed phrase is what makes `UI-75`'s
  "explanation visible in the tile rather than requiring navigation"
  achievable without the tile dominating the layout.
- **Coverage states the actual reason for the gap** ("mostly the payroll and
  HR segments, which are excluded from scope") rather than just "93%" —
  tested against a real number, a bare percentage invites the question "is
  the 7% a problem?" which the product can usually answer for free from the
  exclusion registry, so it does.
- **SLA tile leads with the count that matters most (overdue), not the
  largest number (on-time)** — "187 on time" is the biggest number but the
  least actionable one; overdue and approaching-due are what `MOD-14`
  actually asks this tile to surface as first-class filters.
- **Six tiles fit above the fold at 1440px in a 2-column arrangement**, not
  the 3-column grid a generic admin dashboard defaults to — three columns
  made "Top issues by risk" too narrow to show a real CVE title plus its
  explanation on two lines without wrapping badly, which is exactly the
  kind of thing that only shows up with real content (`UI-01`).

## Empty state (before any scan has run)

```
┌────────────────────────────────────────────────────────────────────────────────┐
│  Dashboard                                                                        │
├────────────────────────────────────────────────────────────────────────────────┤
│                                                                                   │
│                  Nothing has been assessed yet.                                  │
│                  Declare an authorised scope and run a scan to see risk posture, │
│                  coverage, and SLA compliance here.                              │
│                                                                                   │
│                  [ Declare a scope and run a scan ]                              │
│                                                                                   │
└────────────────────────────────────────────────────────────────────────────────┘
```

Per `UI-77`: a single action, not six zeroed tiles. A grid of six "0" tiles
would technically be honest but reads as broken, not as "you haven't done
the first thing yet."
