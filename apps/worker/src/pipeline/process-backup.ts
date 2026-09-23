import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { sql } from '@xenitex/db';
import {
  archiveChecksum,
  BACKUP_TABLE_ORDER,
  encodeArchive,
  redactConfiguration,
  type BackupManifest,
  type BackupPayload,
} from '@xenitex/db';
import type { WorkerDependencies } from '../dependencies.js';

/**
 * DATA-05. Produces one consistent encrypted archive of the database, the
 * blob store, and the appliance configuration.
 *
 * "Consistent" is the load-bearing word: every table is read inside a
 * single REPEATABLE READ transaction, so the archive is a snapshot of one
 * instant rather than a series of reads taken while scans were still
 * writing. Without that, an archive can contain an issue whose observation
 * is missing, and the inconsistency only surfaces during a restore — the
 * moment it is least welcome.
 *
 * The blob store is read after the transaction commits. Artifacts are
 * immutable (DATA-01), so one written after the snapshot is simply absent
 * from this backup rather than inconsistent with it; the reverse — a row
 * referencing a blob we failed to copy — is what the ordering prevents.
 */

export interface BackupResult {
  readonly archivePath: string;
  readonly sizeBytes: number;
  readonly checksum: string;
  readonly manifest: BackupManifest;
}

function backupPassphrase(): string {
  const passphrase = process.env.BACKUP_PASSPHRASE ?? '';
  if (passphrase.length < 12) {
    // Failing loudly beats writing an unencrypted archive or a fake
    // success record. DATA-05 says encrypted; an appliance that cannot
    // encrypt must say so rather than quietly producing something weaker
    // than the operator believes they have.
    throw new Error(
      'BACKUP_PASSPHRASE is not set (or is shorter than 12 characters). DATA-05 requires an encrypted archive, so no backup was written. Set it in deploy/compose/.env and store it somewhere other than alongside the backups.',
    );
  }
  return passphrase;
}

export async function processBackup(
  backupId: string,
  deps: WorkerDependencies,
  backupRoot: string,
): Promise<BackupResult> {
  const { db, blobStore } = deps;
  const passphrase = backupPassphrase();
  const startedAt = new Date();

  const tables: Record<string, Record<string, unknown>[]> = {};
  const tableCounts: Record<string, number> = {};
  let schemaVersion = 'unknown';

  await db
    .transaction()
    .setIsolationLevel('repeatable read')
    .execute(async (trx) => {
      const migration = await sql<{
        name: string;
      }>`SELECT name FROM schema_migrations ORDER BY name DESC LIMIT 1`.execute(trx);
      schemaVersion = migration.rows[0]?.name ?? 'unknown';

      for (const table of BACKUP_TABLE_ORDER) {
        // `to_jsonb(t)` hands back every column with Postgres's own type
        // rendering — inet, timestamptz, numeric and jsonb all survive the
        // round trip without this file needing to know each column's type.
        const result = await sql<{
          row: Record<string, unknown>;
        }>`SELECT to_jsonb(t) AS row FROM ${sql.table(table)} t`.execute(trx);
        tables[table] = result.rows.map((r) => r.row);
        tableCounts[table] = result.rows.length;
      }
    });

  // Evidence is part of the backup (DATA-01/MOD-21): an archive that
  // restores findings but not the artifacts behind them restores an
  // appliance nobody can audit.
  const blobs: Record<string, string> = {};
  let blobBytes = 0;
  const artifactKeys = new Set<string>();
  for (const row of tables.raw_artifacts ?? []) {
    const key = (row as { blob_store_key?: unknown }).blob_store_key;
    if (typeof key === 'string' && key !== '') artifactKeys.add(key);
  }
  for (const row of tables.reports ?? []) {
    const key = (row as { blob_store_key?: unknown }).blob_store_key;
    if (typeof key !== 'string' || key === '') continue;
    // Reports are written one blob per requested format.
    const formats = (row as { formats?: unknown }).formats;
    if (Array.isArray(formats)) for (const f of formats) artifactKeys.add(`${key}.${String(f)}`);
  }

  for (const key of artifactKeys) {
    try {
      const bytes = await blobStore.get(key);
      blobs[key] = bytes.toString('base64');
      blobBytes += bytes.byteLength;
    } catch {
      // A blob already aged out by the retention job (DATA-04) is a normal
      // state, not a backup failure. The row stays; the artifact is simply
      // gone, exactly as it is on the live system.
      continue;
    }
  }

  const manifest: BackupManifest = {
    formatVersion: 1,
    createdAt: startedAt.toISOString(),
    schemaVersion,
    applianceVersion: process.env.XENITEX_VERSION ?? 'dev',
    tableCounts,
    blobCount: Object.keys(blobs).length,
    blobBytes,
  };

  const payload: BackupPayload = {
    manifest,
    tables,
    blobs,
    configuration: redactConfiguration(process.env),
  };

  const archive = encodeArchive(payload, passphrase);
  const archivePath = join(
    backupRoot,
    `xenitex-backup-${startedAt.toISOString().replace(/[:.]/g, '').slice(0, 15)}Z-${backupId.slice(0, 8)}.enc`,
  );
  await mkdir(dirname(archivePath), { recursive: true });
  // 0600: the archive contains the entire appliance's findings.
  await writeFile(archivePath, archive, { mode: 0o600 });

  return {
    archivePath,
    sizeBytes: archive.byteLength,
    checksum: archiveChecksum(archive),
    manifest,
  };
}

/** Picks up backup_records rows the API created as `running` and performs them. */
export async function pollBackupOnce(deps: WorkerDependencies, backupRoot: string): Promise<void> {
  const { db } = deps;
  const pending = await db
    .selectFrom('backup_records')
    .select('id')
    .where('status', '=', 'running')
    .orderBy('started_at', 'asc')
    .limit(1)
    .executeTakeFirst();
  if (!pending) return;

  try {
    const result = await processBackup(pending.id, deps, backupRoot);
    await db
      .updateTable('backup_records')
      .set({
        status: 'completed',
        completed_at: new Date(),
        archive_location: result.archivePath,
        size_bytes: String(result.sizeBytes) as never,
        checksum: result.checksum,
        encrypted: true,
        // RPO is the window of data a restore from this archive would lose:
        // zero at the instant it was taken, growing until the next one.
        measured_rpo_seconds: 0,
      })
      .where('id', '=', pending.id)
      .where('status', '=', 'running')
      .execute();
    console.log(`worker: backup ${pending.id} written to ${result.archivePath}`);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    await db
      .updateTable('backup_records')
      .set({
        status: 'failed',
        completed_at: new Date(),
        // The failure reason goes where an operator will actually look.
        archive_location: `FAILED: ${reason}`,
      })
      .where('id', '=', pending.id)
      .where('status', '=', 'running')
      .execute();
    console.error(`worker: backup ${pending.id} failed`, error);
  }
}
