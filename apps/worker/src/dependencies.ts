import { createDb, FilesystemBlobStore, type DB } from '@xenitex/db';
import type { Kysely } from 'kysely';
import { TcpConnectDiscoveryAdapter, type ScannerAdapter } from '@xenitex/scanner-adapters';
import type { WorkerConfig } from './config.js';

/** SEC-03: apps/worker builds its own dependency set the same way apps/api does (packages/db's createDb), never a bespoke connection. */
export interface WorkerDependencies {
  readonly db: Kysely<DB>;
  readonly blobStore: FilesystemBlobStore;
  readonly adapters: ReadonlyMap<string, ScannerAdapter>;
}

export function buildDependencies(config: WorkerConfig): WorkerDependencies {
  const db = createDb({ connectionString: config.databaseUrl });
  const blobStore = new FilesystemBlobStore(config.blobStoreRoot);
  const networkDiscovery = new TcpConnectDiscoveryAdapter(blobStore);
  return {
    db,
    blobStore,
    adapters: new Map([[networkDiscovery.capabilities().adapterKey, networkDiscovery]]),
  };
}

export async function closeDependencies(deps: WorkerDependencies): Promise<void> {
  await deps.db.destroy();
}
