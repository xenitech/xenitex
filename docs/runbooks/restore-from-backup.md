# Restore from backup

**Use this when:** the appliance has lost data, is being rebuilt after an
incident, or is being moved to new hardware.

**What a backup contains:** one encrypted archive holding the database, the
blob store (all raw scanner artifacts — the evidence behind every finding),
and the appliance configuration. All three together; they are only
meaningful as a set, because a finding without its artifact cannot be
inspected.

**What it does not contain:** the TLS private key, and the encryption
passphrase itself. Store those separately — a backup passphrase kept
alongside the backup protects nobody.

---

## Before you start

You need three things. Confirm you have all of them before touching
anything:

1. The backup archive (`xenitex-backup-<timestamp>.tar.gz.enc`).
2. The **encryption passphrase**. Without it the archive is unreadable, and
   there is no recovery path — that is the point of encrypting it.
3. Enough free disk for the restored data plus the archive itself.

## Step 1 — choose which backup

Panel → **Administration** → **Backup**, or on the host:

```
ls -la /var/backups/xenitex/
```

**Restoring after a suspected compromise?** Choose a backup taken _before_
the earliest suspicious audit entry — see
[appliance-suspected-compromised.md](appliance-suspected-compromised.md)
Step 4. Restoring a backup taken after the intrusion restores the intrusion.

## Step 2 — stop the appliance

```
cd deploy/compose
docker compose stop api worker web
```

Leave `postgres` running — the restore writes into it.

## Step 3 — verify the archive before you rely on it

Check it decrypts and its contents look right, _before_ destroying anything:

```
openssl enc -d -aes-256-cbc -pbkdf2 \
  -in xenitex-backup-20260901T0200Z.tar.gz.enc \
  -out /tmp/xenitex-backup.tar.gz
tar -tzf /tmp/xenitex-backup.tar.gz | head -20
```

You should see `database.sql`, `blob-store/`, and `config/`.

| Problem               | Meaning                                                                                                                          |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `bad decrypt`         | Wrong passphrase, or the file is corrupted. **Stop.** Do not proceed; find the right passphrase or another backup.               |
| `tar: unexpected EOF` | The archive is truncated. Use a different one.                                                                                   |
| Missing `blob-store/` | Evidence was not captured. You can restore the database, but findings will have no inspectable artifacts. Prefer another backup. |

## Step 4 — restore the database

```
tar -xzf /tmp/xenitex-backup.tar.gz -C /tmp/xenitex-restore
docker compose exec -T postgres psql -U postgres -c "DROP DATABASE IF EXISTS xenitex_old;"
docker compose exec -T postgres psql -U postgres -c "ALTER DATABASE xenitex RENAME TO xenitex_old;"
docker compose exec -T postgres psql -U postgres -c "CREATE DATABASE xenitex;"
docker compose exec -T postgres psql -U postgres xenitex < /tmp/xenitex-restore/database.sql
```

The rename rather than a drop is deliberate: if the restore turns out to be
wrong, the previous state is still there as `xenitex_old`. Drop it only once
you have confirmed the restore in Step 7.

## Step 5 — restore the blob store

```
docker compose cp /tmp/xenitex-restore/blob-store/. api:/var/lib/xenitex/blob-store/
docker compose run --rm --user root --entrypoint /bin/sh api -c \
  'chown -R 10001:10001 /var/lib/xenitex/blob-store'
```

The ownership step matters — the API and worker run as a fixed non-root user
and cannot fix permissions themselves.

## Step 6 — start up

```
docker compose up -d
docker compose logs -f api
```

Wait for the readiness check to pass:

```
docker compose exec api wget -qO- http://127.0.0.1:8443/readyz
```

## Step 7 — verify the restore before trusting it

Work through all five. A restore is not finished until you have.

- [ ] **Sign in.** Accounts and passwords are as they were at backup time.
- [ ] **Issue counts look right.** Dashboard totals match roughly what you
      expect for the backup's date.
- [ ] **Evidence resolves.** Open any issue → Evidence tab → click through
      to the raw artifact. It must download. This is the check that proves
      the blob store restored, and it is the one most often skipped.
- [ ] **Audit chain verifies.** Administration → Audit log → chain indicator
      shows intact. A break here means the restore was incomplete.
- [ ] **Vulnerability data age** is what it was at backup time. If it is now
      stale, see
      [vulnerability-data-is-stale.md](vulnerability-data-is-stale.md).

Only after all five pass:

```
docker compose exec -T postgres psql -U postgres -c "DROP DATABASE xenitex_old;"
shred -u /tmp/xenitex-backup.tar.gz
rm -rf /tmp/xenitex-restore
```

## Step 8 — resume scanning

Scheduled scans may have been disabled (a global stop does that
deliberately). Re-enable them: Scope & exclusions → **Schedules**.

Then run a fresh scan. Findings restored from backup reflect the network as
it was at backup time, not as it is now.

## Recovery objectives

| Measure               | Target   | Meaning                                                        |
| --------------------- | -------- | -------------------------------------------------------------- |
| RPO (data loss)       | 24 hours | Backups run nightly, so at most a day of scan results is lost. |
| RTO (time to restore) | 2 hours  | For a populated appliance at the reference specification.      |

These are exercised in CI against seeded data on every release, not
estimated. If your restore is taking materially longer than the RTO, stop
and escalate rather than improvising — something is wrong with the archive
or the host.

## Rehearse this

A backup nobody has ever restored is a hypothesis, not a backup. Rehearse a
full restore onto a spare host at least once per quarter, and time it. The
first time you follow this runbook should not be during an incident.
