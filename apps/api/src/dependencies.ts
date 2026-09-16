import { createDb, FilesystemBlobStore, type DB } from '@xenitex/db';
import type { Kysely } from 'kysely';
import { Redis } from 'ioredis';
import type { ApiConfig } from './config.js';

/**
 * Every dependency a route handler needs, built once at startup and passed
 * through Fastify's decoration mechanism (`app.decorate('deps', ...)`)
 * rather than each route module reaching for a module-level singleton —
 * this is what makes `apps/api/src/server.test.ts` able to build a server
 * against a fake/in-memory set of dependencies without touching a real
 * Postgres for the tests that don't need one.
 */
export interface ApiDependencies {
  readonly db: Kysely<DB>;
  readonly redis: Redis;
  readonly blobStore: FilesystemBlobStore;
}

export function buildDependencies(config: ApiConfig): ApiDependencies {
  const db = createDb({ connectionString: config.databaseUrl });
  const redis = new Redis(config.redisUrl, {
    // Fail fast on connect issues rather than buffering commands
    // indefinitely — readyz needs to observe a real failure, not hang.
    maxRetriesPerRequest: 2,
    lazyConnect: true,
  });
  const blobStore = new FilesystemBlobStore(config.blobStoreRoot);

  return { db, redis, blobStore };
}

export async function closeDependencies(deps: ApiDependencies): Promise<void> {
  await deps.db.destroy();
  deps.redis.disconnect();
}
