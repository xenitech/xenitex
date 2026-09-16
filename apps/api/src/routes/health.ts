import type { FastifyInstance } from 'fastify';
import { sql } from '@xenitex/db';
import type { ApiDependencies } from '../dependencies.js';

/** How stale the vulnerability data can get before readyz reports the appliance as degraded (OPS-03/OPS-04). */
const VULNERABILITY_DATA_STALENESS_THRESHOLD_DAYS = 14;

type CheckStatus = 'ok' | 'error' | 'not_configured';

async function checkDatabase(deps: ApiDependencies): Promise<CheckStatus> {
  try {
    await sql`SELECT 1`.execute(deps.db);
    return 'ok';
  } catch {
    return 'error';
  }
}

async function checkRedis(deps: ApiDependencies): Promise<CheckStatus> {
  try {
    if (deps.redis.status === 'wait') await deps.redis.connect();
    const pong = await deps.redis.ping();
    return pong === 'PONG' ? 'ok' : 'error';
  } catch {
    return 'error';
  }
}

async function checkBlobStore(deps: ApiDependencies): Promise<CheckStatus> {
  try {
    // A cheap round-trip against a fixed key — proves the mounted volume is
    // actually writable, not just that the class constructed without error.
    const probeKey = '.readyz-probe';
    await deps.blobStore.put(probeKey, Buffer.from('ok'), 'text/plain');
    await deps.blobStore.get(probeKey);
    return 'ok';
  } catch {
    return 'error';
  }
}

async function vulnerabilityDataAge(
  deps: ApiDependencies,
): Promise<{ status: CheckStatus; ageDays: number | null }> {
  try {
    const latest = await deps.db
      .selectFrom('vulnerability_data_imports')
      .select('imported_at')
      .where('status', '=', 'applied')
      .orderBy('imported_at', 'desc')
      .limit(1)
      .executeTakeFirst();
    if (!latest) return { status: 'not_configured', ageDays: null };
    const ageDays = (Date.now() - new Date(latest.imported_at).getTime()) / 86_400_000;
    return {
      status: ageDays <= VULNERABILITY_DATA_STALENESS_THRESHOLD_DAYS ? 'ok' : 'error',
      ageDays,
    };
  } catch {
    return { status: 'error', ageDays: null };
  }
}

/**
 * OPS-03. /healthz is a pure liveness check — no dependency calls, so it never
 * false-negatives because Postgres is briefly slow. /readyz checks every
 * downstream dependency and degrades past the vulnerability-data staleness
 * threshold, per OPS-03/OPS-04.
 */
export async function registerHealthRoutes(
  app: FastifyInstance,
  deps: ApiDependencies,
): Promise<void> {
  app.get('/healthz', async () => {
    return { status: 'ok' as const };
  });

  app.get('/readyz', async (_request, reply) => {
    const [database, redis, blobStore, vulnData] = await Promise.all([
      checkDatabase(deps),
      checkRedis(deps),
      checkBlobStore(deps),
      vulnerabilityDataAge(deps),
    ]);
    const checks = {
      database,
      redis,
      blobStore,
      vulnerabilityDataAge: vulnData.status,
    };
    const ready = Object.values(checks).every((c) => c === 'ok');
    reply.code(ready ? 200 : 503);
    return {
      status: ready ? ('ready' as const) : ('not_ready' as const),
      checks,
      vulnerabilityDataAgeDays: vulnData.ageDays,
    };
  });
}
