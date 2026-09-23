/**
 * DATA-05's other half. A backup nobody can restore is not a backup, so
 * this is a first-class, documented command rather than a script in an
 * appendix — see docs/runbooks/restore-from-backup.md.
 *
 * Usage (from the appliance host, in deploy/compose):
 *   docker compose exec api node dist/cli/restore.js --archive <path> --verify
 *   docker compose exec api node dist/cli/restore.js --archive <path> --confirm-destructive
 *
 * `--verify` reads and validates the archive and prints what it contains,
 * changing nothing. That is the default, and it is the step the runbook
 * tells an operator to run BEFORE trusting an archive — a restore is not
 * the moment to discover the passphrase is wrong.
 */
import { readFile } from 'node:fs/promises';
import { createDb, decodeArchive, sql, BACKUP_TABLE_ORDER, type DB } from '@xenitex/db';
import type { Kysely } from 'kysely';
import { loadConfig } from '../config.js';

interface Args {
  readonly archive: string | undefined;
  readonly verify: boolean;
  readonly confirmDestructive: boolean;
  readonly help: boolean;
}

export function parseArgs(argv: readonly string[]): Args {
  let archive: string | undefined;
  let verify = false;
  let confirmDestructive = false;
  let help = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--archive' || arg === '-a') archive = argv[++i];
    else if (arg === '--verify' || arg === '-v') verify = true;
    else if (arg === '--confirm-destructive') confirmDestructive = true;
    else if (arg === '--help' || arg === '-h') help = true;
  }
  return { archive, verify, confirmDestructive, help };
}

const USAGE = `
Xenitex restore (DATA-05)

  --archive, -a <path>     The .enc archive to read. Required.
  --verify,  -v            Validate and describe the archive. Changes nothing.
  --confirm-destructive    Actually restore. REPLACES ALL CURRENT DATA.
  --help,    -h            This message.

The passphrase comes from BACKUP_PASSPHRASE, the same value the backup was
written with. Without it the archive cannot be read — there is no recovery
path, which is the point of encrypting it.

Exit codes: 0 success, 1 usage error, 2 archive unreadable, 3 restore failed.
`.trim();

function describe(payload: ReturnType<typeof decodeArchive>): void {
  const { manifest } = payload;
  console.log(`  format version:    ${manifest.formatVersion}`);
  console.log(`  created at:        ${manifest.createdAt}`);
  console.log(`  schema version:    ${manifest.schemaVersion}`);
  console.log(`  appliance version: ${manifest.applianceVersion}`);
  console.log(
    `  evidence blobs:    ${manifest.blobCount} (${Math.round(manifest.blobBytes / 1024)} KiB)`,
  );
  console.log('  table row counts:');
  const counts = Object.entries(manifest.tableCounts).filter(([, n]) => n > 0);
  for (const [table, count] of counts.sort((a, b) => b[1] - a[1])) {
    console.log(`    ${String(count).padStart(8)}  ${table}`);
  }
  if (counts.length === 0) console.log('    (empty archive)');
}

/**
 * Restores in dependency order, inside one transaction. Either the whole
 * appliance comes back or nothing changes — a half-restored security
 * appliance, showing some findings and not others, is worse than one that
 * is plainly still broken.
 */
async function restore(db: Kysely<DB>, payload: ReturnType<typeof decodeArchive>): Promise<void> {
  await db.transaction().execute(async (trx) => {
    // The schema has two deliberate foreign-key cycles (issues <-> exceptions,
    // and asset_identity_keys -> observations -> assets -> asset_identity_keys).
    // No ordering of whole tables can satisfy a cycle, so those two
    // constraints — and only those two, per migration 0016 — are deferred to
    // COMMIT. Every other constraint stays immediate, so a malformed archive
    // still fails at the statement that introduces the bad row.
    await sql`SET CONSTRAINTS ALL DEFERRED`.execute(trx);

    // Clear in REVERSE dependency order so foreign keys stay satisfied at
    // every step, rather than disabling constraints — which would let a
    // malformed archive load rows the schema would normally reject.
    for (const table of [...BACKUP_TABLE_ORDER].reverse()) {
      await sql`DELETE FROM ${sql.table(table)}`.execute(trx);
    }

    for (const table of BACKUP_TABLE_ORDER) {
      const rows = payload.tables[table] ?? [];
      if (rows.length === 0) continue;

      // Generated columns cannot be written to: `issues.confidence_label`
      // is GENERATED ALWAYS from `confidence`, and Postgres rejects
      // "cannot insert a non-DEFAULT value into column" if it appears in
      // the insert at all. The backup captures whole rows with `to_jsonb`,
      // so generated columns are present in the archive — they are simply
      // recomputed on insert rather than restored, which is what makes
      // them generated in the first place.
      const columns = await sql<{ column_name: string }>`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = ${table}
          AND is_generated = 'NEVER'
          AND COALESCE(identity_generation, '') <> 'ALWAYS'
        ORDER BY ordinal_position
      `.execute(trx);
      const writable = columns.rows.map((c) => c.column_name);
      if (writable.length === 0) continue;

      const columnList = sql.join(
        writable.map((c) => sql.ref(c)),
        sql`, `,
      );
      await sql`
        INSERT INTO ${sql.table(table)} (${columnList})
        SELECT ${columnList}
        FROM jsonb_populate_recordset(NULL::${sql.table(table)}, ${JSON.stringify(rows)}::jsonb)
      `.execute(trx);
    }

    // Sessions were deliberately excluded from the archive; make sure none
    // survive from the pre-restore appliance either. Everyone signs in
    // again, which is the correct outcome after a restore and essential
    // when restoring because of a suspected compromise.
    await sql`DELETE FROM sessions`.execute(trx);
  });
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(USAGE);
    return 0;
  }
  if (!args.archive) {
    console.error('error: --archive <path> is required.\n');
    console.error(USAGE);
    return 1;
  }

  const passphrase = process.env.BACKUP_PASSPHRASE ?? '';
  if (passphrase.length < 12) {
    console.error('error: BACKUP_PASSPHRASE is not set (or is too short).');
    return 1;
  }

  let payload: ReturnType<typeof decodeArchive>;
  try {
    payload = decodeArchive(await readFile(args.archive), passphrase);
  } catch (error) {
    console.error(`error: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }

  console.log(`Archive ${args.archive}:`);
  describe(payload);

  if (!args.confirmDestructive) {
    console.log('\nArchive is readable and internally consistent. Nothing was changed.');
    if (!args.verify) {
      console.log(
        'Re-run with --confirm-destructive to REPLACE ALL CURRENT DATA with this archive.',
      );
    }
    return 0;
  }

  const config = loadConfig();
  const db = createDb({ connectionString: config.databaseUrl });
  try {
    console.log('\nRestoring — this replaces all current data...');
    await restore(db, payload);
    console.log('Restore complete.');
    console.log('\nNext steps (docs/runbooks/restore-from-backup.md):');
    console.log('  1. Restore the blob store separately if evidence artifacts are needed.');
    console.log('  2. Sign in — all sessions were cleared, so everyone must authenticate again.');
    console.log(
      '  3. Verify an issue’s evidence link resolves, and that the audit chain verifies.',
    );
    return 0;
  } catch (error) {
    console.error('error: restore failed and was rolled back.', error);
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
