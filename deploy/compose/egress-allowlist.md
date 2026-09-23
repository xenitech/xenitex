# Egress allowlist (SEC-04)

`SEC-04`: **egress is denied by default. Every allowlist entry below is
documented with its reason.**

This file is the authoritative list. `docker-compose.yml` cannot enforce it —
a Docker bridge network scopes which _containers_ share a network, it does
not restrict where they may connect. Enforcement is at the **host firewall**,
and this document is what that firewall should be configured from.

If an entry here is not one your deployment needs, remove it from the
firewall. The appliance degrades gracefully rather than failing: an
intelligence sync with no connectivity is recorded as "no connectivity",
which is a distinct, non-alarming state (`FEED-15`), not an error.

---

## `api` container

| Destination                     | Port | Reason                                     |
| ------------------------------- | ---- | ------------------------------------------ |
| `postgres` (compose `internal`) | 5432 | Application database.                      |
| `redis` (compose `internal`)    | 6379 | Sessions, idempotency keys, rate limiting. |

**No outbound internet egress at all.** The API container must never be able
to reach a public address. If it can, that is a misconfiguration.

## `worker` container

| Destination                     | Port                   | Reason                                                                                                                                                                                                             | Required?                          |
| ------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------- |
| `postgres` (compose `internal`) | 5432                   | Pipeline state, findings.                                                                                                                                                                                          | Yes                                |
| Authorised scope CIDR ranges    | TCP, adapter port list | **This is the scanning itself.** Restrict to the CIDR ranges in your `authorized_scopes` records — that firewall rule is a genuine third enforcement layer beneath `SAFE-01`'s plan-time and dispatch-time checks. | Yes                                |
| `services.nvd.nist.gov`         | 443                    | NVD CVE records, fetched only when an administrator explicitly invokes an intelligence sync. Never automatic, never scheduled.                                                                                     | **No — omit for air-gapped sites** |
| `epss.cyentia.com`              | 443                    | EPSS exploit-probability scores, same trigger as above.                                                                                                                                                            | **No — omit for air-gapped sites** |

### About the two internet destinations

These are the only public destinations any container in this appliance ever
contacts, and they exist for one purpose: keeping the vulnerability
catalogue current without a manual bundle transfer.

What is sent: a date-range query for CVEs modified within a window, and a
request for the current EPSS score file. **No customer data is transmitted** —
not asset addresses, not hostnames, not findings, not counts, not an
identifier for the appliance. `DATA-07` holds.

Neither destination is user-editable from the panel (`FEED-19`). An operator
who needs a proxy configures a proxy; they do not add destinations. An
editable destination list would turn the appliance into an arbitrary egress
channel, which is exactly the property a read-only security appliance must
not have.

**For an air-gapped deployment**, omit both firewall rules and set
`intel_settings.online_updates_disabled = true` (Administration →
Intelligence). Vulnerability data then arrives exclusively through the signed
offline bundle (`FEED-16`) — see
[docs/runbooks/vulnerability-data-is-stale.md](../../docs/runbooks/vulnerability-data-is-stale.md).

## `web` container

| Destination            | Port | Reason                    |
| ---------------------- | ---- | ------------------------- |
| `api` (compose `edge`) | 8443 | Reverse proxy for `/v1/`. |

No outbound internet egress. The panel bundles every asset it needs —
no CDN, no external fonts, no analytics (`P1-26`), and the Content-Security-
Policy in `web-nginx.conf` restricts the browser to the appliance's own
origin, so a dependency that started reaching outward would be blocked
client-side as well.

## `postgres` / `redis` containers

No egress. They sit on the compose `internal` network, which is declared
`internal: true`, so Docker itself provides no route out for them.

## Verifying

From the appliance host, confirm the API cannot reach the internet:

```
docker compose exec api wget -T 5 -qO- https://example.com && echo "FAIL: api has internet egress"
```

That command should time out. If it returns content, the host firewall is
not enforcing this document.
