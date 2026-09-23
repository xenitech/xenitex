# A scan is stuck

**Use this when:** a scan run has been `running` or `queued` far longer than
its pre-flight estimate, or its progress count has not moved.

**Before anything else:** a slow scan is not a broken scan. The appliance
paces itself deliberately (SAFE-04) — a large scope at a low packets-per-
second setting takes a long time _by design_. Check the estimate shown when
the scan was created before treating slowness as a fault.

---

## Step 1 — decide which of four things is happening

Panel → **Scans** → the run in question.

| Symptom                                                  | Likely cause                                                  | Go to  |
| -------------------------------------------------------- | ------------------------------------------------------------- | ------ |
| Status `queued`, never starts                            | Worker not running, or another scan holds the lane            | Step 2 |
| Status `running`, progress advancing slowly but steadily | Pacing — working as configured                                | Step 3 |
| Status `running`, progress frozen at the same count      | Worker died mid-run, or every remaining target is unreachable | Step 4 |
| Status `running`, but it is inside a blackout window     | Working as configured — it is waiting                         | Step 5 |

## Step 2 — a queued scan that never starts

Check the worker is alive:

```
docker compose ps worker
docker compose logs --tail=50 worker
```

| What you see                                            | Meaning                                 | Fix                                                                |
| ------------------------------------------------------- | --------------------------------------- | ------------------------------------------------------------------ |
| Not listed / `Exit 1`                                   | The worker is not running.              | `docker compose up -d worker`                                      |
| Restart loop                                            | It is crashing at startup.              | Read the log; usually a database or blob-store permission problem. |
| `worker: starting scan-run poll loop` and nothing since | It is idle but not picking work up.     | Check the run's status really is `queued`, not `paused`.           |
| It is busy with a different run                         | Only one scan runs at a time by design. | Wait, or abort the other run.                                      |

## Step 3 — it is just pacing

Open the scan profile (Scope & exclusions → **Profiles**) and read
`packetsPerSecond` and `concurrentHosts`. Rough expectation:

```
seconds ≈ (hosts x ports-per-host) / packetsPerSecond
```

`safe` probes 23 ports per host. So 254 hosts at 50 packets/second is
roughly `254 x 23 / 50` ≈ 117 seconds of probing, plus per-port timeouts on
unreachable hosts — which dominate. A scope that is mostly empty address
space is much slower than one that is mostly live hosts, because every dead
address costs a full 2-second connect timeout.

**This is not a fault.** If it is too slow for your window, raise the
profile's pacing — but raise it deliberately, and never above the ceiling in
Administration → pacing ceilings, which exists precisely so a profile cannot
be set to something harmful.

## Step 4 — progress genuinely frozen

First, confirm it is frozen rather than slow. Note the completed count, wait
two minutes, look again.

If it truly has not moved:

```
docker compose logs --tail=200 worker
```

| Log shows                                              | Meaning                                                                         | Fix                                                                           |
| ------------------------------------------------------ | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Repeated `failed to process observation`               | Individual targets are failing; the run is progressing but every target errors. | Usually DNS. Check the scope's hostname entries resolve.                      |
| Nothing recent at all                                  | The worker is wedged or dead.                                                   | Step 4a                                                                       |
| `refusing to dispatch ... not within authorized scope` | The run contains targets its scope does not cover.                              | The run will finish, marking them failed. Report this — it should not happen. |

### Step 4a — restart the worker

This is safe. Scan state lives in the database, not in the worker's memory,
so a restarted worker picks the run back up from where it left off and
already-completed targets are not re-probed.

```
docker compose restart worker
docker compose logs -f worker
```

Give it one poll interval (about 5 seconds) and check the panel again.

## Step 5 — it is inside a blackout window

Scope & exclusions → **Blackout windows**. If one covers now, the run is
paused between hosts on purpose and will continue when the window closes.
This is correct behaviour, not a fault.

If the window is wrong (entered in the wrong timezone is the common one),
edit it there.

## Step 6 — abort it

If none of the above resolves it, aborting is safe and loses nothing but
the remaining targets:

Panel → **Scans** → the run → **Abort**, with a reason.

Everything already collected is kept. Findings from the completed portion
remain, with their evidence.

## When to escalate

Escalate to engineering, with `docker compose logs --since 1h worker`
attached, if:

- The worker crash-loops after a restart.
- Progress freezes again at the same target on a second attempt.
- The log shows `out_of_scope` refusals — that means a scan was planned
  against targets no scope authorised, which is a safety-control defect.
