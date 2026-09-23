# Our scan appears to have degraded a customer service

**Use this when:** someone reports a system became slow, unresponsive, or
unreliable, and a scan may be the cause.

**First, the important context:** this appliance is read-only. It opens TCP
connections and reads what a service says back. It never writes, never logs
in, and never sends a payload beyond that. So it cannot have _changed_
anything. What it can do is overwhelm a device that copes badly with
connections — printers, building controllers, medical and industrial
equipment, and old network gear are the usual ones.

---

## Step 1 — stop scanning (do this before diagnosing)

Follow [emergency-stop-all-scans.md](emergency-stop-all-scans.md). Do not
wait until you have confirmed we are the cause. Stopping costs nothing.

## Step 2 — establish whether it was us at all

You need two facts: **did we touch that address**, and **when**.

1. Panel → **Scans** → open the run that was active during the reported
   window.
2. Use the target list filter to search for the affected address.

| What you find                                                                                         | What it means                                                                                       |
| ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| The address is **not** in the target list                                                             | We never contacted it. It was not us. Say so plainly and help them look elsewhere.                  |
| The address is listed as `excluded`                                                                   | An exclusion rule stopped us before dispatch. It was not us.                                        |
| The address is listed as `completed` or `in_progress`, and the timestamps overlap the reported window | We did contact it. Continue to Step 3.                                                              |
| The address is `failed` with `out_of_scope`                                                           | We refused to scan it. It was not us — but report this: it should not have been in the list at all. |

Record the run id, the target's start and end timestamps, and the profile
used. You will need them for the conversation in Step 5.

## Step 3 — check whether it is a fragile device

Panel → **Assets** → the affected asset.

- If it is flagged **Fragile**, the appliance should already have downgraded
  it to passive-inventory. Check the scan run's profile for that target. If
  it was scanned at `safe` or `standard` anyway, that is a defect — file it
  and include the run id.
- If it is **not** flagged fragile but is a printer, controller, medical
  device, or similar, that is the gap. Go to Step 4.

## Step 4 — make sure it cannot happen again, today

Add an exclusion rule before anything restarts.

1. Panel → **Scope & exclusions** → **Exclusions** → **Add rule**.
2. Enter the address (or the range covering that class of device).
3. Give a real reason — future-you will read it: _"Siemens building
   controller, unresponsive during 2026-09-23 scan, ticket INC-4471."_

The rule takes effect at two independent layers: scan planning, and again in
the worker immediately before each target is dispatched. It applies to scans
that are already running, not just new ones — you do not need to wait for
the current run to finish.

Consider also flagging the asset as fragile (Assets → asset → **Fragile**),
which downgrades it to passive-inventory permanently rather than excluding it
entirely. You keep some visibility instead of none.

## Step 5 — the conversation with the affected team

Be direct about what we know and what we do not.

**Say:**

- Whether we contacted the address, with timestamps.
- What we actually sent: TCP connections to a fixed list of ports, and for a
  few HTTP ports, one `HEAD /` request. Nothing else.
- That we have stopped, and added an exclusion.

**Do not say** we were definitely the cause unless the timestamps line up and
there is no other explanation. A scan running nearby is not proof.

**Do not** promise it cannot recur without having added the exclusion.

## Step 6 — before resuming

- [ ] Exclusion rule added and visible in the panel.
- [ ] Affected team has confirmed the service recovered.
- [ ] If the device should have been caught by a fragile-device heuristic and
      was not, that gap is filed.
- [ ] Consider dropping the profile to `safe` or `passive-inventory` for the
      scope this happened in.

Then resume per the "Resuming afterwards" section of
[emergency-stop-all-scans.md](emergency-stop-all-scans.md).

## What to capture for engineering

Attach all of this to the report:

```
docker compose logs --since 2h worker > worker-log.txt
docker compose exec api node dist/cli/global-stop.js --status > activity.txt
```

Plus: the scan run id, the target address, the profile name, the pacing
settings shown on that profile, and the device make and model if known.
