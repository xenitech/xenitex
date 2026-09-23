/**
 * Factory reset (operator-requested).
 *
 * Returns the appliance to the state it had immediately after `pnpm
 * migrate` — as if it had just been installed — so an operator can hand it
 * to a different team, re-run the setup wizard, or clear a development
 * appliance without rebuilding the whole stack.
 *
 * Usage (from the appliance host, in deploy/compose):
 *   docker compose exec api node dist/cli/reset.js --scope findings --confirm
 *   docker compose exec api node dist/cli/reset.js --scope all --confirm
 *
 * Deliberately a CLI and not a panel button. This destroys the audit log,
 * which is the one record that exists precisely so that destructive actions
 * cannot be taken invisibly (DATA-02). Requiring shell access to the
 * appliance host means a stolen session cannot erase the evidence of what
 * it did — the same reasoning that keeps MFA_ENFORCEMENT out of the
 * database.
 */
import { createInterface } from 'node:readline/promises';
import { createDb, sql, type DB } from '@xenitex/db';
import type { Kysely } from 'kysely';
import { loadConfig } from '../config.js';

export type ResetScope = 'findings' | 'scans' | 'all';

interface Args {
  readonly scope: ResetScope | undefined;
  readonly confirm: boolean;
  readonly yes: boolean;
  readonly help: boolean;
}

export function parseArgs(argv: readonly string[]): Args {
  let scope: ResetScope | undefined;
  let confirm = false;
  let yes = false;
  let help = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--scope' || arg === '-s') {
      const value = argv[++i];
      if (value === 'findings' || value === 'scans' || value === 'all') scope = value;
      else scope = undefined;
    } else if (arg === '--confirm') confirm = true;
    else if (arg === '--yes') yes = true;
    else if (arg === '--help' || arg === '-h') help = true;
  }
  return { scope, confirm, yes, help };
}

const USAGE = `
Xenitex reset

  --scope, -s <scope>   What to clear. Required.
  --confirm             Actually do it. Without this, nothing is changed.
  --yes                 Skip the interactive typed confirmation (for scripts).
  --help,  -h           This message.

Scopes, narrowest first:

  findings   Issues, observations, raw artifacts, reports and their history.
             KEEPS: assets, scopes, exclusions, profiles, users, settings,
             vulnerability catalogue, and the audit log.
             Use when re-scanning from scratch after fixing the pipeline.

  scans      Everything in 'findings', plus assets, scan runs and schedules.
             KEEPS: users, scopes, exclusions, profiles, settings, the
             vulnerability catalogue, and the audit log.
             Use when the estate has changed and the inventory is stale.

  all        FACTORY RESET. Everything above, plus users, scopes,
             exclusions, profiles, settings and THE AUDIT LOG. The setup
             wizard runs again on next start.
             KEEPS: the vulnerability catalogue (expensive to re-import and
             not customer data) and applied schema migrations.

Exit codes: 0 success, 1 usage error, 2 cancelled, 3 failed.
`.trim();

/**
 * Deletion order matters: each list is written so that a table is cleared
 * only after everything referencing it, which keeps foreign keys satisfied
 * at every step instead of disabling them.
 */
const FINDINGS_TABLES: readonly string[] = [
  'issue_risk_score_snapshots',
  'issue_state_history',
  'exceptions',
  'verification_scans',
  'issue_observations',
  'issues',
  'observations',
  'raw_artifacts',
  'reports',
  'notification_events',
];

const SCAN_TABLES: readonly string[] = [
  'scan_run_targets',
  'scan_runs',
  'scan_plan_previews',
  'scan_schedules',
  'asset_group_members',
  'asset_groups',
  'asset_services',
  'asset_hostname_history',
  'asset_address_history',
  'asset_identity_keys',
  'assets',
];

const CONFIGURATION_TABLES: readonly string[] = [
  'saved_views',
  'global_stop_events',
  'backup_records',
  'notification_channels',
  'blackout_windows',
  'exclusion_rules',
  'authorized_scopes',
  'audit_entries',
  'sessions',
  'mfa_recovery_codes',
  'auth_events',
  'users',
];

export function tablesForScope(scope: ResetScope): readonly string[] {
  if (scope === 'findings') return FINDINGS_TABLES;
  if (scope === 'scans') return [...FINDINGS_TABLES, ...SCAN_TABLES];
  return [...FINDINGS_TABLES, ...SCAN_TABLES, ...CONFIGURATION_TABLES];
}

export async function performReset(
  db: Kysely<DB>,
  scope: ResetScope,
): Promise<Record<string, number>> {
  const cleared: Record<string, number> = {};
  await db.transaction().execute(async (trx) => {
    for (const table of tablesForScope(scope)) {
      const result = await sql<{ count: string }>`
        WITH deleted AS (DELETE FROM ${sql.table(table)} RETURNING 1)
        SELECT count(*)::text AS count FROM deleted
      `.execute(trx);
      cleared[table] = Number(result.rows[0]?.count ?? 0);
    }

    if (scope === 'all') {
      // organization_settings is a singleton the setup wizard fills in;
      // resetting the completion flag is what makes the wizard run again
      // rather than leaving a configured-looking appliance with no users.
      await sql`
        UPDATE organization_settings
        SET setup_completed_at = NULL, organization_name = NULL
        WHERE id = 1
      `.execute(trx);
    }
  });
  return cleared;
}

async function confirmInteractively(scope: ResetScope): Promise<boolean> {
  const expected = scope === 'all' ? 'FACTORY RESET' : `RESET ${scope.toUpperCase()}`;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    // A typed phrase, not a y/n. Reflex-pressing 'y' is exactly how an
    // irreversible action gets taken by accident.
    const answer = await rl.question(`Type ${expected} to continue: `);
    return answer.trim() === expected;
  } finally {
    rl.close();
  }
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(USAGE);
    return 0;
  }
  if (!args.scope) {
    console.error('error: --scope must be one of: findings, scans, all.\n');
    console.error(USAGE);
    return 1;
  }

  const config = loadConfig();
  const db = createDb({ connectionString: config.databaseUrl });

  try {
    // Always show the real cost before asking. An operator should be able
    // to see they are about to delete 40,000 findings, not discover it
    // afterwards.
    console.log(`Reset scope: ${args.scope}`);
    console.log('Rows that will be deleted:');
    let total = 0;
    for (const table of tablesForScope(args.scope)) {
      const result = await sql<{ count: string }>`
        SELECT count(*)::text AS count FROM ${sql.table(table)}
      `.execute(db);
      const count = Number(result.rows[0]?.count ?? 0);
      total += count;
      if (count > 0) console.log(`  ${String(count).padStart(8)}  ${table}`);
    }
    console.log(`  ${String(total).padStart(8)}  TOTAL`);

    if (args.scope === 'all') {
      console.log(
        '\nThis is a FACTORY RESET. It deletes the audit log, which is the record of\n' +
          'everything this appliance has ever been asked to do. That cannot be undone,\n' +
          'and it cannot be reconstructed. Take a backup first if there is any chance\n' +
          'you will need the history:\n' +
          '  docker compose exec api node dist/cli/... (see docs/runbooks/restore-from-backup.md)',
      );
    }

    if (!args.confirm) {
      console.log('\nNothing was changed. Re-run with --confirm to proceed.');
      return 0;
    }
    if (!args.yes && !(await confirmInteractively(args.scope))) {
      console.log('Cancelled. Nothing was changed.');
      return 2;
    }

    const cleared = await performReset(db, args.scope);
    const deleted = Object.values(cleared).reduce((sum, n) => sum + n, 0);
    console.log(`\nReset complete — ${deleted} row(s) deleted.`);
    if (args.scope === 'all') {
      console.log('The setup wizard will run again the next time the panel is opened.');
    } else {
      console.log('Users, settings and the audit log were left intact.');
    }
    return 0;
  } catch (error) {
    console.error('error: reset failed and was rolled back.', error);
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
