import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyCookie from '@fastify/cookie';
import { OpenAPIBackend, type AjvCustomizer } from 'openapi-backend';
import addFormatsImport from 'ajv-formats';

// ajv-formats ships as CJS; under NodeNext module resolution from an ESM file the
// default-export type doesn't line up with the actual callable runtime value.
const addFormats = addFormatsImport as unknown as AjvCustomizer;
import { AppState } from './app-state.js';
import type { MockServerConfig } from './config.js';
import { sleep, simulatedLatencyMs } from './middleware/latency.js';
import { forcedStatus, shouldInjectRandomFailure } from './middleware/partial-failure.js';
import { hasRole, isValidRole, requiredRole } from './middleware/permissions.js';
import { Problems } from './problem.js';
import { sendProblem } from './handlers/generic.js';
import { resolveSessionUserId, SESSION_COOKIE } from './handlers/sessions.js';
import { buildAuthSetupHandlers } from './handlers/auth-setup.js';
import { buildAdminHandlers } from './handlers/admin.js';
import { buildAssetHandlers } from './handlers/assets.js';
import { buildCatalogHandlers } from './handlers/catalog.js';
import { buildIssueHandlers } from './handlers/issues.js';
import { buildSafetyConfigHandlers } from './handlers/safety-config.js';
import { buildScanHandlers } from './handlers/scans.js';
import { buildReportsNotificationsHandlers } from './handlers/reports-notifications.js';
import { buildAuditHandlers } from './handlers/audit.js';
import { buildDashboardHandlers } from './handlers/dashboard.js';

const here = dirname(fileURLToPath(import.meta.url));
const OPENAPI_SPEC_PATH = resolve(here, '../../../packages/contracts/src/openapi.yaml');

export async function buildMockServer(config: MockServerConfig): Promise<FastifyInstance> {
  const state = new AppState(config);

  const api = new OpenAPIBackend({
    definition: OPENAPI_SPEC_PATH,
    apiRoot: '/v1',
    validate: true,
    customizeAjv: addFormats,
    handlers: {
      ...buildAuthSetupHandlers(state),
      ...buildAdminHandlers(state),
      ...buildAssetHandlers(state),
      ...buildCatalogHandlers(state),
      ...buildIssueHandlers(state),
      ...buildSafetyConfigHandlers(state),
      ...buildScanHandlers(state),
      ...buildReportsNotificationsHandlers(state),
      ...buildAuditHandlers(state),
      ...buildDashboardHandlers(state),
      notFound: (_c, _req, reply) => sendProblem(reply, Problems.notFound('route')),
      notImplemented: (c, _req, reply) => {
        const { status, mock } = api.mockResponseForOperation(c.operation.operationId!);
        reply.code(status).send(mock);
      },
      validationFail: (c, _req, reply) =>
        sendProblem(
          reply,
          Problems.validationFailed(
            c.validation.errors?.map((e) => `${e.instancePath} ${e.message}`).join('; ') ??
              'Request failed schema validation.',
          ),
        ),
    },
  });
  await api.init();

  const app = Fastify({ logger: true });
  await app.register(fastifyCookie);

  // OPS-01: every response carries a correlation identifier — echoed from an
  // inbound X-Correlation-Id if the client sent one, otherwise generated
  // here. A real backend propagates the same id into its queue job and
  // scanner invocation; the mock server has neither, so this is as far as
  // that propagation goes in Step 3, but the header contract the frontend
  // builds against (ErrorState's `correlationId`) is real.
  app.addHook('onRequest', async (request, reply) => {
    const inbound = request.headers['x-correlation-id'];
    const correlationId =
      (Array.isArray(inbound) ? inbound[0] : inbound) ??
      `mock-${Math.random().toString(36).slice(2)}`;
    reply.header('x-correlation-id', correlationId);
  });

  app.all('/v1/*', async (request, reply) => {
    const latencyHeader = request.headers['x-mock-latency'];
    await sleep(
      simulatedLatencyMs(Array.isArray(latencyHeader) ? latencyHeader[0] : latencyHeader),
    );

    const forced = forcedStatus(request.headers['x-mock-force-status']);
    if (forced !== null) return sendProblem(reply, Problems.simulatedFailure(forced));
    if (shouldInjectRandomFailure(request.headers['x-mock-fail-rate']))
      return sendProblem(reply, Problems.simulatedFailure());

    const mockRequest = {
      method: request.method,
      path: request.url.split('?')[0]!,
      query: request.query as Record<string, string>,
      body: request.body,
      headers: request.headers as Record<string, string>,
    };
    const operation = api.matchOperation(mockRequest);
    if (operation?.operationId) {
      const roleHeader = request.headers['x-mock-role'];
      const headerRole = Array.isArray(roleHeader) ? roleHeader[0] : roleHeader;
      const sessionUserId = resolveSessionUserId(request.cookies?.[SESSION_COOKIE]);
      const sessionUser = sessionUserId ? state.users.get(sessionUserId) : undefined;
      const actorRole =
        sessionUser?.role ?? (headerRole && isValidRole(headerRole) ? headerRole : 'administrator');

      const publicOperations = new Set([
        'login',
        'completeMfaChallenge',
        'logout',
        'getSetupStatus',
        'createSetupAdministrator',
        'setSetupOrganization',
        'setSetupTls',
        'createSetupInitialScope',
        'acknowledgeSetupSafetyDefaults',
        'completeSetup',
      ]);
      if (!publicOperations.has(operation.operationId)) {
        const required = requiredRole(operation.operationId, operation.tags ?? [], request.method);
        if (!hasRole(actorRole, required)) return sendProblem(reply, Problems.forbidden(required));
      }
    }

    return api.handleRequest(mockRequest, request, reply);
  });

  app.get('/mock/health', async () => ({ status: 'ok', fixtureScale: config.fixtureScale }));

  return app;
}
