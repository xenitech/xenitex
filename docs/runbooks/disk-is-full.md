# Disk is full

**Use this when:** the panel reports low disk headroom, scans fail to write
artifacts, or the database has gone read-only.

**What fills up, in order of likelihood:**

1. **Raw scanner artifacts** — the evidence behind every finding. Largest by
   far, and the reason the appliance can show you _why_ it believes
   something.
2. **Observations** — one database row per thing seen, per scan.
3. **Postgres WAL** — transaction log; grows if backups stall.
4. **Reports** — small, but they accumulate.

**Never delete anything by hand from inside the containers.** Artifacts are
referenced by findings; removing them by hand leaves findings whose evidence
cannot be inspected, which is worse than having less history.

---

## Step 1 — find out what is actually using the space

On the appliance host:

```
df -h
docker system df -v | head -40
```

Then per volume:

```
docker compose exec api du -sh /var/lib/xenitex/blob-store
docker compose exec postgres du -sh /var/lib/postgresql/data
```

| Biggest consumer          | Go to                                           |
| ------------------------- | ----------------------------------------------- |
| `blob-store`              | Step 2                                          |
| `postgresql/data`         | Step 3                                          |
| Docker images/build cache | Step 4                                          |
| Something outside Docker  | Normal host housekeeping — outside this runbook |

## Step 2 — reduce artifact retention

Panel → **Administration** → **Retention**.

Retention is configured per data class. Shortening the **raw artifacts**
window is almost always the right first move: artifacts are the bulk of the
data, and older ones are the least often inspected.

| Class           | Typical                             | Notes                                                                                   |
| --------------- | ----------------------------------- | --------------------------------------------------------------------------------------- |
| Raw artifacts   | 30–90 days                          | Shorten this first.                                                                     |
| Observations    | 90–180 days                         | Findings survive; only the per-scan statements age out.                                 |
| Resolved issues | 180–365 days                        |                                                                                         |
| **Audit**       | **has a floor you cannot go below** | The panel will not let you shorten this past its minimum. Do not try to work around it. |

Lower the value, save, and let the retention job run. Space is reclaimed as
it deletes.

**What you lose:** the ability to open the raw artifact behind an older
finding. The finding, its evidence summary, its history, and its first-seen
date all remain.

## Step 3 — the database is the problem

Check whether backups are stalling — an unshipped backup keeps WAL segments
alive:

```
docker compose logs --tail=50 postgres | grep -i -E "wal|checkpoint|archiv"
```

Panel → **Administration** → **Backup** → check the last successful backup
date. If backups have been failing, fixing that usually releases a large
amount of space on its own. See
[restore-from-backup.md](restore-from-backup.md) for the backup mechanism.

If the database is genuinely large because you have a lot of findings,
shorten the **observations** retention window in Step 2 — that is where the
row count lives.

## Step 4 — reclaim Docker space

Safe, and often frees several gigabytes:

```
docker image prune -a
docker builder prune
```

**Do not run `docker system prune --volumes`.** That deletes named volumes,
which on this appliance means your database, your evidence, and your TLS
certificate.

## Step 5 — emergency headroom

If you are at zero bytes and need room to act at all:

```
docker compose stop worker
docker compose logs --tail=0 -f > /dev/null    # stop log growth
truncate -s 0 $(docker inspect --format='{{.LogPath}}' $(docker compose ps -q worker))
```

Truncating container logs is safe — they are diagnostic output, not data.
This buys you enough room to then do Step 2 properly.

Restart the worker when you have headroom: `docker compose start worker`.

## Step 6 — prevent recurrence

- [ ] Retention windows set to something the disk can actually sustain.
- [ ] Backups succeeding (check Administration → Backup weekly).
- [ ] Alerting on disk usage. The appliance exposes this at
      `/metrics` (`xenitex_observations`, plus host disk metrics from your
      own node exporter) — point your monitoring at it.
- [ ] If you are consistently out of room at sensible retention windows, the
      disk is undersized for your estate. The reference specification is
      500 GB SSD for 5,000 assets.
