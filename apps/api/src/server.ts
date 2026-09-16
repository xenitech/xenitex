import Fastify, { type FastifyInstance } from 'fastify';
import fastifyCookie from '@fastify/cookie';
import { loadConfig } from './config.js';
import { buildDependencies, closeDependencies, type ApiDependencies } from './dependencies.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerSetupRoutes } from './routes/setup.js';
import { registerScopeRoutes } from './routes/scope.js';
import { registerAdministrationRoutes } from './routes/administration.js';
import { registerIssueRoutes } from './routes/issues.js';
import { registerScanRoutes } from './routes/scans.js';
import { registerExceptionRoutes } from './routes/exceptions.js';
import { registerReportRoutes } from './routes/reports.js';
import { registerAssetRoutes } from './routes/assets.js';
import { registerDashboardRoutes } from './routes/dashboard.js';
import { registerOpsRoutes } from './routes/ops.js';
import { registerSchedulingRoutes } from './routes/scheduling.js';
import { registerSavedViewRoutes } from './routes/saved-views.js';
import { registerIntelRoutes } from './routes/intel.js';

export function buildServer(deps: ApiDependencies): FastifyInstance {
  const app = Fastify({
    logger: true, // OPS-01: replaced with the structured JSON + correlation-id logger plugin later in Step 4.
  });

  app.register(fastifyCookie);
  // /healthz and /readyz stay unprefixed (OPS-03): orchestration health
  // checks hit a stable, version-independent path, not the versioned public
  // contract. Every route the OpenAPI spec actually documents lives under
  // /v1 (its `servers: - url: /v1`), registered here via Fastify's own
  // `prefix` rather than baked into each route's path string, so the
  // contract's versioning is enforced in exactly one place.
  app.register((instance) => registerHealthRoutes(instance, deps));
  app.register((instance) => registerAuthRoutes(instance, deps), { prefix: '/v1' });
  app.register((instance) => registerSetupRoutes(instance, deps), { prefix: '/v1' });
  app.register((instance) => registerScopeRoutes(instance, deps), { prefix: '/v1' });
  app.register((instance) => registerAdministrationRoutes(instance, deps), { prefix: '/v1' });
  app.register((instance) => registerIssueRoutes(instance, deps), { prefix: '/v1' });
  app.register((instance) => registerScanRoutes(instance, deps), { prefix: '/v1' });
  app.register((instance) => registerExceptionRoutes(instance, deps), { prefix: '/v1' });
  app.register((instance) => registerReportRoutes(instance, deps), { prefix: '/v1' });
  app.register((instance) => registerAssetRoutes(instance, deps), { prefix: '/v1' });
  app.register((instance) => registerDashboardRoutes(instance, deps), { prefix: '/v1' });
  app.register((instance) => registerOpsRoutes(instance, deps), { prefix: '/v1' });
  app.register((instance) => registerSchedulingRoutes(instance, deps), { prefix: '/v1' });
  app.register((instance) => registerSavedViewRoutes(instance, deps), { prefix: '/v1' });
  app.register((instance) => registerIntelRoutes(instance, deps), { prefix: '/v1' });

  return app;
}

async function main(): Promise<void> {
  const config = loadConfig();
  const deps = buildDependencies(config);
  const app = buildServer(deps);

  const shutdown = async () => {
    await app.close();
    await closeDependencies(deps);
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  await app.listen({ host: config.host, port: config.port });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
