/**
 * SAFE-07: "One control, reachable from every screen, halting all queued and
 * running scan activity and recording who invoked it. **A documented CLI
 * equivalent must work when the web panel does not.**"
 *
 * The panel button existed; this did not. That gap is the whole point of the
 * requirement: the moment an operator most needs to stop every scan is the
 * moment the appliance is misbehaving — nginx wedged, the API throwing, a
 * browser that cannot reach the private interface — and a stop control that
 * only works when everything else works is not a stop control.
 *
 * This deliberately shares nothing with the HTTP stack. No Fastify, no
 * session, no CSRF, no reverse proxy: a direct database connection and one
 * transaction. The only thing it needs to be working is Postgres, and if
 * Postgres is down there are no running scans to stop.
 *
 * Usage (from the appliance host):
 *   docker compose exec api node dist/cli/global-stop.js --actor <email> [--reason "..."]
 *   docker compose exec api node dist/cli/global-stop.js --status
 *
 * See docs/runbooks/emergency-stop-all-scans.md.
 */
import { createDb, type DB } from '@xenitex/db';
import type { Kysely } from 'kysely';
import { newId } from '@xenitex/domain';
import { appendAuditEntry } from '../audit/audit-log.js';
import { loadConfig } from '../config.js';

interface ParsedArgs {
  readonly actor: string | undefined;
  readonly reason: string | undefined;
  readonly status: boolean;
  readonly help: boolean;
}

export function parseArgs(argv: readonly string[]): ParsedArgs {
  let actor: string | undefined;
  let reason: string | undefined;
  let status = false;
  let help = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--actor' || arg === '-a') actor = argv[++i];
    else if (arg === '--reason' || arg === '-r') reason = argv[++i];
    else if (arg === '--status' || arg === '-s') status = true;
    else if (arg === '--help' || arg === '-h') help = true;
  }
  return { actor, reason, status, help };
}

const USAGE = `
Xenitex emergency stop (SAFE-07)

  --actor,  -a <email>   Who is invoking this. Required, and must match an
                         existing user: a stop that cannot say who ordered it
                         is not auditable (DATA-03).
  --reason, -r <text>    Why. Recorded with the stop event.
  --status, -s           Report what would be halted, and change nothing.
  --help,   -h           This message.

Exit codes: 0 success (including "nothing was running"), 1 usage error,
2 the actor could not be resolved, 3 a database failure.
`.trim();

export interface GlobalStopResult {
  readonly eventId: string;
  readonly haltedScanRunIds: readonly string[];
  readonly disabledScheduleIds: readonly string[];
}

/**
 * Halts everything queued, running, or paused, and disables every enabled
 * schedule.
 *
 * Disabling the schedules is not over-reach: without it, a cron-triggered
 * schedule firing a minute later starts a brand new run and the operator
 * who just pulled the emergency stop watches scanning resume by itself.
 * The panel's own global stop has the same gap and it is fixed there too.
 */
export async function invokeGlobalStop(
  db: Kysely<DB>,
  actorUserId: string,
  reason: string | null,
): Promise<GlobalStopResult> {
  return db.transaction().execute(async (trx) => {
    const haltedRuns = await trx
      .updateTable('scan_runs')
      .set({
        status: 'aborted',
        aborted_by_user_id: actorUserId,
        aborted_reason: reason ?? 'Global stop invoked via CLI',
      })
      .where('status', 'in', ['queued', 'running', 'paused'])
      .returning('id')
      .execute();

    const disabledSchedules = await trx
      .updateTable('scan_schedules')
      .set({ is_enabled: false })
      .where('is_enabled', '=', true)
      .returning('id')
      .execute();

    const eventId = newId();
    await trx
      .insertInto('global_stop_events')
      .values({
        id: eventId,
        invoked_by_user_id: actorUserId,
        invoked_via: 'cli',
        reason,
        scan_runs_halted: haltedRuns.map((r) => r.id),
      })
      .execute();

    await appendAuditEntry(trx, {
      actorUserId,
      sessionId: null,
      // No HTTP request, so no source address. Recorded as the appliance
      // itself rather than left blank — DATA-03 wants a source, and "a
      // shell on the appliance host" is the honest answer.
      sourceAddress: '127.0.0.1',
      action: 'global_stop.invoked',
      targetType: 'global_stop_event',
      targetId: eventId,
      beforeState: null,
      afterState: {
        via: 'cli',
        scanRunsHalted: haltedRuns.map((r) => r.id),
        schedulesDisabled: disabledSchedules.map((r) => r.id),
        reason,
      },
      outcome: 'success',
    });

    return {
      eventId,
      haltedScanRunIds: haltedRuns.map((r) => r.id),
      disabledScheduleIds: disabledSchedules.map((r) => r.id),
    };
  });
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(USAGE);
    return 0;
  }

  const config = loadConfig();
  const db = createDb({ connectionString: config.databaseUrl });

  try {
    if (args.status) {
      const active = await db
        .selectFrom('scan_runs')
        .select(['id', 'status', 'queued_at'])
        .where('status', 'in', ['queued', 'running', 'paused'])
        .orderBy('queued_at', 'asc')
        .execute();
      const schedules = await db
        .selectFrom('scan_schedules')
        .select(['id', 'name'])
        .where('is_enabled', '=', true)
        .execute();
      console.log(`Active scan runs: ${active.length}`);
      for (const run of active) console.log(`  ${run.id}  ${run.status}`);
      console.log(`Enabled schedules: ${schedules.length}`);
      for (const schedule of schedules) console.log(`  ${schedule.id}  ${schedule.name}`);
      return 0;
    }

    if (!args.actor) {
      console.error('error: --actor <email> is required.\n');
      console.error(USAGE);
      return 1;
    }

    const actor = await db
      .selectFrom('users')
      .select(['id', 'email'])
      .where('email', '=', args.actor)
      .executeTakeFirst();
    if (!actor) {
      console.error(`error: no user with email ${args.actor}.`);
      console.error('Run with --status to inspect activity without an actor.');
      return 2;
    }

    const result = await invokeGlobalStop(db, actor.id, args.reason ?? null);
    console.log(`Global stop recorded as ${result.eventId} by ${actor.email}.`);
    console.log(`  Scan runs halted:    ${result.haltedScanRunIds.length}`);
    console.log(`  Schedules disabled:  ${result.disabledScheduleIds.length}`);
    if (result.disabledScheduleIds.length > 0) {
      console.log('\nRe-enable schedules deliberately once the cause is understood:');
      console.log('  Administration -> Scope & exclusions -> Schedules');
    }
    // The worker notices within one poll interval (WORKER_POLL_INTERVAL_MS,
    // default 5s) because processScanRun re-reads scan_runs.status on every
    // iteration of its dispatch loop. Say so, rather than letting an
    // operator wonder whether it took.
    console.log('\nIn-flight scans stop between hosts, within one worker poll (~5s).');
    return 0;
  } catch (error) {
    console.error('error: global stop failed.', error);
    return 3;
  } finally {
    await db.destroy();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().then(
    (code) => process.exit(code),
    (error) => {
      console.error(error);
      process.exit(3);
    },
  );
}
