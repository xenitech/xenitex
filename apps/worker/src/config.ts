/** Mirrors apps/api/src/config.ts's conventions exactly (SEC-03: same env shape, both containers). */
export interface WorkerConfig {
  readonly databaseUrl: string;
  readonly blobStoreRoot: string;
  readonly pollIntervalMs: number;
  /** SEC-03: per-job working directory root (tmpfs in deploy/compose/docker-compose.yml). */
  readonly jobWorkingDirectoryRoot: string;
  /** DATA-05: where encrypted backup archives are written. A dedicated volume, never the blob store. */
  readonly backupRoot: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  return {
    databaseUrl: env.DATABASE_URL ?? 'postgres://postgres:xenitex_dev@127.0.0.1:5432/xenitex_dev',
    blobStoreRoot: env.BLOB_STORE_ROOT ?? '/tmp/xenitex-blob-store',
    pollIntervalMs: env.WORKER_POLL_INTERVAL_MS
      ? Number.parseInt(env.WORKER_POLL_INTERVAL_MS, 10)
      : 5000,
    jobWorkingDirectoryRoot: env.JOB_WORKING_DIRECTORY_ROOT ?? '/var/run/xenitex-job',
    backupRoot: env.BACKUP_ROOT ?? '/var/lib/xenitex/backups',
  };
}
