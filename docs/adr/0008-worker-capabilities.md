# ADR 0008: Worker container capability grant (`NET_RAW`)

- Status: **Superseded at Step 4** — see "Update" at the end of this ADR.
- Requirements: `SEC-02`, `SEC-03`

## Context

`SEC-02` requires every container to run with all capabilities dropped
except those individually justified. The `worker` container in
`deploy/compose/docker-compose.yml` is the one exception in the reference
deployment, adding back `NET_RAW`.

## Decision

Grant `NET_RAW` to the `worker` container only. Every other container
(`api`, `web`, `postgres`, `redis`) runs with `cap_drop: ALL` and no
capabilities added back.

**Justification:** the network-discovery adapter (`P2-04`) needs raw-socket
access for standard host/port discovery techniques (e.g. SYN-based port
scanning) that cannot be performed through ordinary connect()-based sockets
without a full TCP handshake per port, which would make discovery far slower
and change its network fingerprint in ways that matter for `SAFE-04`'s
pacing guarantees. This is a well-understood, narrowly-scoped requirement —
it does not grant the container the ability to configure or execute
anything on a remote host (that would require far more than `NET_RAW`, and
this product doesn't do that regardless — see `docs/adr/0005-read-only-principle.md`).

The `worker` container still runs non-root, with a read-only root
filesystem, `no-new-privileges`, and no database credentials directly
(`SEC-03` — it reaches Postgres/Redis only through the same repository
interfaces the API does, and holds no long-lived secret beyond what its
`env_file` provides for that purpose).

## Consequences

- `NET_RAW` inside a container is still meaningfully contained by the
  `scan_egress` network boundary in `docker-compose.yml`: the worker's raw
  sockets can reach whatever the host's networking allows, which a real
  deployment scopes at the host firewall to the customer's declared
  `authorized_scope` CIDR ranges — this container capability grant does not
  bypass `SAFE-01`/`SAFE-02` scope and exclusion enforcement, which happen in
  application code before any packet is sent.
- This is the kind of grant `SEC-02` wants surfaced explicitly rather than
  buried in a compose file — flagging it here means a future change to
  _remove_ it (e.g. switching the discovery adapter to a library that
  doesn't need raw sockets) has an ADR to update, and a future change to
  _add another capability elsewhere_ has a template to follow (justify it
  in an ADR, don't just add it to the compose file).

## Alternatives considered

- **`CAP_NET_ADMIN` or running the worker container privileged.** Rejected
  outright — both are far broader than what raw-socket discovery needs and
  would fail any adversarial review (`5.6`) trivially.
- **Connect()-based discovery only, no raw sockets, no added capability.**
  Considered as the safest option. Rejected for v1 on the grounds that
  discovery speed within `PERF-03`'s documented window (a full /16 pass) is
  materially worse without SYN-based scanning; revisit if a future adapter
  implementation proves connect()-based discovery is fast enough in
  practice, at which point this ADR should be superseded and the capability
  removed.

## Update (Step 4): superseded, capability removed

The first real `network-discovery` adapter
(`packages/scanner-adapters/src/tcp-connect-adapter.ts`) was **not** built
by wrapping Nmap: `docs/licence-review.md` Finding 1 (`LEG-02`) is explicit
that bundling Nmap in a closed-source build is blocked on an OEM licence
that hasn't been purchased, and its recommendation is to not default to
bundling Nmap in the reference build until that's resolved. The adapter is
instead a plain `node:net` TCP-connect scanner with protocol-aware banner
grabbing (SSH/FTP/SMTP banners read directly; an HTTP `HEAD` request for
web ports) — exactly the "connect()-based discovery" alternative this ADR's
own "Alternatives considered" section anticipated.

`NET_RAW` has been removed from the `worker` service in
`deploy/compose/docker-compose.yml`: a plain TCP connect needs no raw
socket, so keeping the grant would violate `SEC-02`'s "every capability
individually justified" the moment it stopped being used. If a real Nmap
adapter is added later (OEM licence purchased, or shipped as a
customer-installed add-on per `LEG-03`), re-add `NET_RAW` with a fresh ADR
rather than reviving this one — this document's job was the original
grant's justification, which no longer holds.

Known trade-off, not hidden: `PERF-03`'s /16-in-a-documented-window target
is harder to hit with connect-scan's full TCP handshake per port than with
Nmap's SYN scanning. Untested at that scale as of this change (only
verified against a /24 in practice) — revisit if `5.5`'s load testing shows
it's a real bottleneck.
