# The appliance is suspected compromised

**Use this when:** you have reason to believe someone has gained
unauthorised access to the appliance — unexpected sign-ins, scans nobody
started, audit entries nobody recognises, or a host-level indicator.

**Read this first — it should shape how alarmed you are.**

This appliance is deliberately built so that compromising it gives an
attacker _a list of your problems, not the ability to create new ones_:

- It holds **no credentials for your systems**. No SSH keys, no passwords,
  no API tokens. There is no vault to steal because there is nothing to
  vault.
- It has **no SSH client, no configuration-management engine, and no
  remote-execution library** anywhere in its dependency tree. This is
  verified automatically on every build, not merely asserted.
- It **cannot write to anything on your network.** It opens TCP connections
  and reads responses. That is the entire capability.

So the realistic worst case is: an attacker learns which of your systems are
vulnerable. That is genuinely bad — it is a target list. It is not the same
as an attacker gaining a foothold, and you should say so clearly when you
report this, because the difference changes the response.

---

## Step 1 — contain (first 5 minutes)

**Stop scanning**, so the appliance is not generating traffic while you
investigate:

```
cd deploy/compose
docker compose exec api node dist/cli/global-stop.js --actor you@example.com --reason "Suspected compromise"
```

**Isolate the appliance at the network layer** — block it at your firewall
or unplug it. Do this from the network side, not from inside the appliance:
if it is compromised, you cannot trust anything it tells you.

**Do not** power it off, rebuild it, or `docker compose down`. That destroys
the evidence you are about to need.

## Step 2 — preserve evidence (next 15 minutes)

Capture before you change anything.

```
mkdir -p /tmp/xenitex-ir && cd /tmp/xenitex-ir
docker compose logs --no-color > compose-logs.txt
docker compose ps -a > containers.txt
docker compose exec -T postgres pg_dump -U postgres xenitex > db-snapshot.sql
docker inspect $(docker compose ps -q) > inspect.json
date -u > captured-at-utc.txt
```

Copy all of it **off the appliance** to somewhere you trust.

## Step 3 — verify the audit chain

The audit log is hash-chained: every entry stores a hash of itself plus the
previous entry's hash, so entries cannot be altered or removed without
breaking the chain.

Panel → **Administration** → **Audit log** → chain-verification indicator.

Or directly:

```
docker compose exec api wget -qO- http://127.0.0.1:8443/v1/audit-chain/verify
```

| Result                        | What it tells you                                                                                                                                                                                     |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Chain intact                  | Nobody tampered with the audit record. **You can trust what it says.** Go to Step 4.                                                                                                                  |
| Chain broken, with a position | Someone with database access altered or removed entries at that point. Treat everything from there on as unreliable, and note the position — it is a strong time anchor for when access was obtained. |
| Verification will not run     | Database problem, or the API is not functioning. Work from the `db-snapshot.sql` you captured.                                                                                                        |

## Step 4 — read the audit record

Panel → **Administration** → **Audit log**. Look for:

| Look for                                                  | Why it matters                                                    |
| --------------------------------------------------------- | ----------------------------------------------------------------- |
| `auth.login_success` from unfamiliar source addresses     | The likeliest entry point.                                        |
| `auth.login_failure` bursts before a success              | Credential guessing that eventually worked.                       |
| `auth.mfa_enrolled` you do not recognise                  | An attacker enrolling their own second factor.                    |
| `raw_artifact.downloaded` in bulk                         | Evidence being exfiltrated — this is the data of real value here. |
| `report.requested` you did not request                    | The efficient way to take everything at once.                     |
| `scan_run.created` you did not create                     | Using the appliance to map your network.                          |
| `exclusion_rule` deletions, `fragile_device_rule.updated` | Safety controls being removed — check whether any harm followed.  |
| `global_stop.invoked`                                     | Note whether this is your own Step 1 action.                      |

Write down: earliest suspicious entry, the accounts involved, and the source
addresses.

## Step 5 — assess what was exposed

Assume anything the compromised account could read, was read:

- **Your vulnerability findings** — which systems are vulnerable to what.
  This is the target list. Treat it as though an attacker now has it.
- **Your asset inventory** — addresses, hostnames, open ports, service
  versions.
- **Your scope definitions** — which ranges you own.

Assume **not** exposed, because they do not exist on this appliance:

- Credentials to any of your systems.
- Any ability to change your systems.

## Step 6 — recover

Only after Steps 1–5 are complete and evidence is off the box.

1. **Rebuild rather than clean.** Stand up a fresh appliance from a known-good
   offline bundle on new storage. Do not try to disinfect this one.
2. **Restore data selectively.** See
   [restore-from-backup.md](restore-from-backup.md), and restore from a
   backup taken _before_ the earliest suspicious audit entry.
3. **Reset every account.** New passwords, new TOTP enrolment, new recovery
   codes, for everyone. Do not carry the old ones across.
4. **Install a proper TLS certificate** if the appliance was still on the
   self-signed one — see
   [install-tls-certificate.md](install-tls-certificate.md).
5. **Re-scan everything.** Findings from before the incident were produced by
   a system you no longer trust.

## Step 7 — prioritise remediation of what was exposed

The findings the attacker saw are now a live target list. Work the
known-exploited and internet-facing items first — the same ranking the
appliance already gives you, but now with real urgency behind it.

## Escalate to engineering if

- The audit chain verification reports a break. That means database-level
  access, which is a more serious finding than panel access and we need the
  details.
- You find evidence the appliance sent traffic to any destination outside
  your network. It has no code path that does this, and no egress
  allowlist entry for it — if it happened, that is a defect we must see.
