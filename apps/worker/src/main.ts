import { buildDependencies, closeDependencies, type WorkerDependencies } from './dependencies.js';
import { loadConfig } from './config.js';
import { processScanRun } from './pipeline/process-scan-run.js';
import { processIntelImport } from './pipeline/process-intel-import.js';

/**
 * 4.4's pipeline runner. No BullMQ/Redis queue here (unlike the comment this
 * file used to carry) — at PERF-01 scale (a single-VPS appliance, one worker
 * replica in deploy/compose/docker-compose.yml) a short DB poll loop gives
 * the same practical guarantee — a queued scan_run gets picked up promptly —
 * with far less to debug than a distributed queue, and it costs nothing to
 * introduce BullMQ later since nothing outside this loop knows how a scan
 * run gets picked up. `processScanRun` re-checks scan_runs.status on every
 * iteration of its own inner loop, so pause/resume/abort (SAFE-07/UI-88) take
 * effect within one poll tick without this outer loop needing to know about
 * them.
 */
let inFlight = false;
let intelInFlight = false;

/** Independent of pollOnce's scan-run flag — an intel sync and a scan run are unrelated job types and shouldn't block each other. */
async function pollIntelOnce(deps: WorkerDependencies): Promise<void> {
  if (intelInFlight) return;
  const runnable = await deps.db
    .selectFrom('vulnerability_data_imports')
    .select('id')
    .where('status', '=', 'validating')
    .where('source_name', '=', 'nvd')
    .orderBy('imported_at', 'asc')
    .limit(1)
    .executeTakeFirst();
  if (!runnable) return;

  intelInFlight = true;
  try {
    await processIntelImport(runnable.id, deps.db);
  } catch (error) {
    console.error(`worker: intel import ${runnable.id} failed`, error);
    await deps.db
      .updateTable('vulnerability_data_imports')
      .set({ status: 'failed', failure_reason: String(error instanceof Error ? error.message : error) })
      .where('id', '=', runnable.id)
      .where('status', '=', 'validating')
      .execute();
  } finally {
    intelInFlight = false;
  }
}

async function pollOnce(deps: WorkerDependencies, jobWorkingDirectoryRoot: string): Promise<void> {
  if (inFlight) return;
  const runnable = await deps.db
    .selectFrom('scan_runs')
    .select('id')
    .where('status', 'in', ['queued', 'running'])
    .orderBy('queued_at', 'asc')
    .limit(1)
    .executeTakeFirst();
  if (!runnable) return;

  inFlight = true;
  try {
    await processScanRun(runnable.id, deps, jobWorkingDirectoryRoot);
  } catch (error) {
    console.error(`worker: scan run ${runnable.id} failed`, error);
    await deps.db
      .updateTable('scan_runs')
      .set({ status: 'failed' })
      .where('id', '=', runnable.id)
      .where('status', 'in', ['queued', 'running'])
      .execute();
  } finally {
    inFlight = false;
  }
}

export function main(): void {
  console.log('worker: starting scan-run poll loop');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
  const config = loadConfig();
  const deps = buildDependencies(config);

  const pollTimer = setInterval(() => {
    pollOnce(deps, config.jobWorkingDirectoryRoot).catch((error) => {
      console.error('worker: poll tick failed', error);
    });
    pollIntelOnce(deps).catch((error) => {
      console.error('worker: intel poll tick failed', error);
    });
  }, config.pollIntervalMs);

  const shutdown = (signal: NodeJS.Signals): void => {
    console.log(`worker: received ${signal}, shutting down`);
    clearInterval(pollTimer);
    closeDependencies(deps)
      .catch((error) => console.error('worker: error closing dependencies', error))
      .finally(() => process.exit(0));
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}
