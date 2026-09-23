# Runbooks

`OPS-05`. Written for a competent operator who is **not** an engineer on this
project — plain language, explicit commands, and an honest statement of what
each action costs.

| Runbook                                                                  | Use it when                                                                              |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| [emergency-stop-all-scans.md](emergency-stop-all-scans.md)               | You need scanning to stop now. Start here if you are unsure.                             |
| [scan-degraded-a-service.md](scan-degraded-a-service.md)                 | Someone reports a system became slow or unresponsive and a scan may be the cause.        |
| [scan-is-stuck.md](scan-is-stuck.md)                                     | A scan run is not progressing.                                                           |
| [vulnerability-data-is-stale.md](vulnerability-data-is-stale.md)         | The panel warns that vulnerability data is old.                                          |
| [disk-is-full.md](disk-is-full.md)                                       | Low disk headroom, or writes are failing.                                                |
| [appliance-suspected-compromised.md](appliance-suspected-compromised.md) | You suspect unauthorised access to the appliance itself.                                 |
| [restore-from-backup.md](restore-from-backup.md)                         | Data has been lost, or the appliance is being rebuilt or moved.                          |
| [install-tls-certificate.md](install-tls-certificate.md)                 | Replacing the self-signed certificate with your own. Do this before the pilot goes live. |

## Two things that hold across all of them

**Stopping is always safe.** This appliance only observes — it never changes
anything on your network. A stopped appliance collects no new information;
it cannot cause harm by being stopped. Never hesitate to stop first and
diagnose second.

**Prefer the audited path.** The panel and the CLI both record who did what
and why. Stopping a container directly works, but nobody's name is attached
to it. Use the blunt instrument when you must, and write down that you did.
