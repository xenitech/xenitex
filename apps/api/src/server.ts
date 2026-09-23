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
import { registerEvidenceRoutes } from './routes/evidence.js';
import { registerCatalogRoutes } from './routes/catalog.js';
import { registerMetricsRoutes } from './routes/metrics.js';

export function buildServer(
  deps: ApiDependencies,
  options: { readonly trustedProxies?: readonly string[] } = {},
): FastifyInstance {
  const app = Fastify({
    logger: true, // OPS-01: replaced with the structured JSON + correlation-id logger plugin later in Step 4.
    // See ApiConfig.trustedProxies. An empty list means "trust nothing",
    // which is Fastify's own default and the right answer when apps/api is
    // reached directly (`pnpm dev`, integration tests).
    ...(options.trustedProxies && options.trustedProxies.length > 0
      ? { trustProxy: [...options.trustedProxies] }
      : {}),
  });

  app.register(fastifyCookie);
  // /healthz and /readyz stay unprefixed (OPS-03): orchestration health
  // checks hit a stable, version-independent path, not the versioned public
  // contract. Every route the OpenAPI spec actually documents lives under
  // /v1 (its `servers: - url: /v1`), registered here via Fastify's own
  // `prefix` rather than baked into each route's path string, so the
  // contract's versioning is enforced in exactly one place.
  app.register((instance) => registerHealthRoutes(instance, deps));
  // OPS-02: unprefixed alongside /healthz and /readyz — a Prometheus scrape
  // is infrastructure, not part of the versioned public contract, and
  // nginx never proxies anything outside /v1/ so it stays internal.
  app.register((instance) => registerMetricsRoutes(instance, deps));
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
  app.register((instance) => registerEvidenceRoutes(instance, deps), { prefix: '/v1' });
  app.register((instance) => registerCatalogRoutes(instance, deps), { prefix: '/v1' });

  return app;
}

async function main(): Promise<void> {
  const config = loadConfig();
  const deps = buildDependencies(config);
  const app = buildServer(deps, { trustedProxies: config.trustedProxies });

  // WORK-04: never describe a partial control as implemented. SEC-09 makes
  // TOTP mandatory for operator and administrator; if this deployment has
  // turned the enrolment gate off, that is a legitimate operator decision
  // but it must be stated plainly on every start, not discoverable only by
  // reading configuration. The whole reason the previous client-side
  // `MFA_ENFORCEMENT_DISABLED_FOR_NOW` flag was dangerous is that nothing
  // announced it.
  if (config.mfaEnforcement === 'optional') {
    app.log.warn(
      {
        control: 'SEC-09',
        mfaEnforcement: 'optional',
      },
      'SEC-09 NOT ENFORCED: operator and administrator accounts may use this appliance without enrolling TOTP. ' +
        'Individual users can still enrol voluntarily, and once enrolled their TOTP challenge is required at every login. ' +
        'Set MFA_ENFORCEMENT=mandatory (the default) to require enrolment before a privileged account can be used.',
    );
  }

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
