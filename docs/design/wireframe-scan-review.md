# Wireframe — Scan wizard, step 4: Review (Archetype B)

Per `UI-72`, this is the most carefully designed screen in the product —
it's the interface expression of `SAFE-08`. Ordinal step markers are
permitted here (`UI-15`): this genuinely is a sequence.

```
┌──────────────────────────────────────────────────────┐
│  New scan                                             │
│  1 Scope ── 2 Profile ── 3 Schedule ── ● 4 Review      │
├──────────────────────────────────────────────────────┤
│                                                        │
│  Scope           Production network — 10.20.0.0/16    │
│  Profile         Safe                                 │
│  Schedule        Now, one-time                        │
│                                                        │
│  Targets                                        4,096 │
│  Estimated packets                            ~180,000│
│  Estimated duration                        ~42 minutes│
│                                                        │
│  ── Excluded targets (12) ──────────────────────────  │
│                                                        │
│  10.20.4.0/24            Payroll segment — excluded   │
│                          by finance-network-exclusion │
│  10.20.9.201             HR file server — excluded by │
│                          hr-fileserver-exclusion       │
│  10.20.12.0/28           Building management VLAN —   │
│                          excluded by bms-exclusion     │
│  … 9 more                              [ Show all ]   │
│                                                        │
│  ── Fragile-device downgrades (3) ───────────────────  │
│                                                        │
│  10.20.6.44   HP LaserJet MFP        → passive-inventory│
│  10.20.6.51   HP LaserJet MFP        → passive-inventory│
│  10.20.14.10  Siemens S7-1200 PLC    → passive-inventory│
│               matched: legacy-network-gear heuristic   │
│                                                        │
│  ── Pacing (Safe profile) ───────────────────────────  │
│                                                        │
│  Packets/second        400   (ceiling: 2,000)         │
│  Concurrent hosts       20   (ceiling: 100)           │
│  Ports per host          8   (ceiling: 32)            │
│  Timeout               3.0s                           │
│                                                        │
│  ────────────────────────────────────────────────────│
│                              [ Cancel ]  [ Start scan ]│
└──────────────────────────────────────────────────────┘
```

## While the plan is still computing

```
│  Targets                                    calculating…│
│  Estimated packets                          calculating…│
│  Estimated duration                         calculating…│
│                                                          │
│  ── Excluded targets ────────────────────────────────  │
│  calculating…                                           │
│                                                          │
│  ────────────────────────────────────────────────────  │
│                              [ Cancel ]  [ Start scan ]  │  ← disabled, greyed
```

`Start scan` is disabled — not spinning, not optimistically enabled — until
every section above has real numbers. This is `UI-72`'s explicit
instruction, and it's worth stating why it matters more here than the
usual "don't let people click during a loading state" reason: if `Start
scan` became clickable while the exclusion list was still computing, an
operator could confirm a plan that hasn't actually finished checking
exclusions yet. The disabled state isn't a loading-spinner courtesy, it's
part of the safety guarantee.

## Decisions this content exposed

- **Exclusion reasons needed the actual rule name, not just the CIDR**, once
  a real list was tried — "10.20.4.0/24" alone tells an operator nothing
  about _why_ it's excluded; "Payroll segment — excluded by
  finance-network-exclusion" lets them verify the exclusion is the one they
  meant, per `UI-73`'s "must be able to verify the exclusion did what they
  intended."
- **Fragile downgrades show the matched heuristic name** ("legacy-network-gear
  heuristic"), not just "fragile device detected" — an operator reviewing
  this needs to judge whether the heuristic was right, which requires
  knowing which one fired.
- **Pacing shows the ceiling next to the configured value**, not on a
  separate screen — "400 (ceiling: 2,000)" in one line answers "how much
  headroom is there" without a second lookup, which matters because this is
  the moment an operator decides whether `standard` intrusiveness is
  actually needed here or `safe` pacing is already close to the ceiling.
- **"12 excluded" and "Show all" rather than listing all 12 by default** —
  tested with a realistic count; three examples plus a count and an
  expansion control read faster than 12 rows competing with the
  fragile-device section for the same screen, and nothing here should
  require scrolling to reach the confirm control on a 1440px viewport.
