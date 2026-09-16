# ADR 0001: Four-entity domain model (Asset, Vulnerability, Observation, Issue)

- Status: Accepted at GATE 1. Open question resolved: Exception stays a
  supporting object of Issue (not promoted to a fifth entity) for this
  release.
- Requirements: `MOD-01`–`MOD-04`, `SCOPE-02`

## Context

A vulnerability management product's single most common failure mode is
collapsing everything into one flat "findings" table: scanner output, in,
findings, out. It looks simple for the first 500 rows and becomes unusable
by 5,000 — the same underlying problem shows up as forty rows because it was
seen on forty scans, there's nowhere to attach an owner or a due date that
isn't itself a duplicate-prone mutation of a raw scan result, and there is no
stable identity to hang a lifecycle or an SLA off of.

`SCOPE-02` calls this out explicitly as one of the two decisions (the other
being the scanner adapter boundary) that make the entire deferred-work list
(Part F) additive rather than a rewrite. Getting it wrong here is expensive
precisely because everything downstream — the pipeline stages in 4.4, every
screen in Step 3, every report in 4.8 — is written against these shapes.

## Decision

Four distinct entities, each with a distinct lifecycle and distinct write
pattern:

1. **Asset** (`MOD-01`) — a stable, resolved identity. Mutable in the sense
   that its current state (addresses, services, tags) changes over time, but
   changes are additive to history, not destructive.
2. **Vulnerability** (`MOD-02`) — a catalogue fact, entirely independent of
   any asset. It exists whether or not anything in the environment is
   affected by it. Owned by the vulnerability-data import pipeline (4.3), not
   by the scanning pipeline.
3. **Observation** (`MOD-03`) — an immutable, append-only statement: "adapter
   X said Y about target Z at time T, and here is the raw evidence." Never
   updated, never deleted except by the retention job. This is the layer that
   makes `MOD-21` ("no finding may exist without evidence a reviewer can
   inspect") a structural guarantee rather than a UI convention.
4. **Issue** (`MOD-04`) — the deduplicated, human-facing unit of work. One row
   per stable fingerprint (`MOD-08`), pointing at an asset, optionally at a
   vulnerability, and at every observation that corroborates it. This is
   where lifecycle state, ownership, due dates, exceptions, and the computed
   risk score live.

The relationship is strictly: Observations accumulate evidence.
Identity resolution and fingerprinting turn observations into (at most) one
Issue per stable fingerprint per Asset. Vulnerabilities are looked up, never
created by the scanning pipeline. See `docs/database-schema.md` §2 for the
full entity-relationship diagram and every supporting table.

## Consequences

- Every pipeline stage in 4.4 has a single, unambiguous entity it writes:
  ingest/parse/normalise produce Observations; resolve-identity attaches an
  Asset; fingerprint/deduplicate/correlate produce or update an Issue;
  enrich looks up a Vulnerability; score writes to Issue plus a score
  snapshot.
- `MOD-21`'s evidence guarantee falls out of the model rather than needing
  separate enforcement: an Issue's evidence is nothing more than a join
  through `issue_observations` to `observations.untrusted_evidence` and
  `raw_artifacts`.
- Cost: four tables (plus their supporting tables) instead of one means more
  joins on the hot read paths (issue list, issue detail). `PERF-02`'s p95
  targets are the check on whether this cost is acceptable at `PERF-01`
  volumes — see the indexing choices in `docs/database-schema.md` §11.
- This is the correct place to push back if wrong. If GATE 1 review finds a
  fifth first-class entity is needed (a strong candidate that came up while
  writing this: should "Exception" be a fifth top-level entity rather than a
  supporting object of Issue? It has its own approval workflow and its own
  register per `MOD-12`, arguably justifying first-class status) — raise it
  now. It is far cheaper before Step 3/4 are built against the current shape
  than after.

## Alternatives considered

- **Flat findings table.** Rejected outright — this is the anti-pattern
  `QA-00`/`MOD-21` and the general instructions exist specifically to avoid.
- **Three-entity model (merge Observation into Issue, keep only the latest
  evidence).** Rejected: destroys `MOD-09` corroboration (multiple adapters
  agreeing on one issue) and makes `MOD-21`'s "link to the raw artifact"
  requirement retroactive and lossy the moment a second scan runs.
- **Five-entity model (split Exception out, per the note above).** Not
  adopted for Step 1, but flagged for GATE 1 discussion rather than silently
  decided either way (`WORK-03`).
