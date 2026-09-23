# Emergency: stop all scanning immediately

**Use this when:** you need scanning to stop now — a service is degrading, a
device is behaving oddly, someone has asked you to stand down, or you simply
are not sure and want to be safe. Stopping is always the safe choice. This
appliance only observes; nothing is lost by stopping it.

**Time to effect:** in-flight probes finish the host they are on and stop.
That is normally under 5 seconds.

---

## Option 1 — the panel (try this first)

The red **Global stop** control is in the top bar of every screen.

1. Click **Global stop**.
2. Type a short reason (this is recorded against your name).
3. Confirm.

The panel shows how many scan runs were halted. Scheduled scans are also
disabled so nothing restarts by itself.

## Option 2 — the command line (when the panel does not respond)

Use this if the panel will not load, times out, or shows an error. It talks
to the database directly and does not depend on the web server.

On the appliance host, from the `deploy/compose` directory:

```
docker compose exec api node dist/cli/global-stop.js \
  --actor you@example.com \
  --reason "Service degradation reported on the finance VLAN"
```

Use the email address you sign in to the panel with. You should see:

```
Global stop recorded as <id> by you@example.com.
  Scan runs halted:    3
  Schedules disabled:  2

In-flight scans stop between hosts, within one worker poll (~5s).
```

To see what is running **without stopping anything**:

```
docker compose exec api node dist/cli/global-stop.js --status
```

### If the command fails

| Message                    | Meaning                                     | Do this                                                             |
| -------------------------- | ------------------------------------------- | ------------------------------------------------------------------- |
| `no user with email ...`   | The address does not match an account.      | Check it, or run `--status` to at least see activity.               |
| `global stop failed`       | The database is unreachable.                | See Option 3 — if the database is down, nothing is scanning anyway. |
| `Error: No such container` | Compose is not running from this directory. | `cd` to `deploy/compose` and retry.                                 |

## Option 3 — stop the worker outright (last resort)

If neither option above works, stop the process that performs scans:

```
docker compose stop worker
```

This halts scanning immediately and unconditionally. It leaves the panel and
the data intact — you can still read findings, you just cannot scan.

**This is not audited** — nobody's name is attached to it — so prefer
Options 1 or 2 whenever they work, and note in your own records that you did
this and why.

To resume later: `docker compose start worker`.

---

## After you have stopped

1. **Confirm it took.** Reload the panel's Scans screen; no run should be
   `running` or `queued`. Or run `--status` again and expect zero.
2. **Tell whoever is affected**, if a service was degrading. See
   [scan-degraded-a-service.md](scan-degraded-a-service.md).
3. **Leave it stopped** until the cause is understood. There is no pressure
   to resume — the appliance is read-only, so a paused appliance is simply an
   appliance that is not collecting new information.

## Resuming afterwards

Global stop disables scheduled scans on purpose, so they do not restart
before you are ready.

1. Panel → **Scope & exclusions** → **Schedules**.
2. Re-enable each schedule you still want, one at a time.
3. Start any one-off scan the normal way.

If you stopped the worker in Option 3, also run `docker compose start worker`.
