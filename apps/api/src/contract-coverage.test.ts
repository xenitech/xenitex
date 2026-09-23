import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { after, test } from 'node:test';
import { loadConfig } from './config.js';
import { buildDependencies, closeDependencies } from './dependencies.js';
import { buildServer } from './server.js';

/**
 * GATE 2 froze the OpenAPI specification as "the single source of truth"
 * (2.1) and `P1-02` forbids hand-written API types precisely so the client
 * and the server cannot drift. Nothing, however, checked that the server
 * actually *implements* what the contract declares — and 34 of the 131
 * documented operations had no handler at all, including the raw-artifact
 * download every evidence link in the panel points at (`MOD-21`).
 *
 * The generated client, the mock server, and the panel were all built
 * against those operations, so the drift was invisible until a real request
 * hit a real 404. This test closes that hole: a documented operation with
 * no route is a build failure, not a support ticket.
 */

const require = createRequire(import.meta.url);

function specPath(): string {
  // Resolved through the workspace dependency rather than a relative
  // `../../packages/...` path, so it keeps working regardless of where the
  // test is run from or how the workspace is laid out.
  return require.resolve('@xenitex/contracts/openapi.yaml');
}

/**
 * A deliberately small YAML path extractor rather than a YAML dependency:
 * this only needs the `paths:` keys and their HTTP methods, and adding a
 * parser to apps/api purely for a test would put it in the shipped
 * dependency tree that `PRIN-03` audits.
 */
function declaredOperations(yaml: string): Set<string> {
  const lines = yaml.split('\n');
  const operations = new Set<string>();
  let inPaths = false;
  let currentPath: string | null = null;

  for (const line of lines) {
    if (/^paths:\s*$/.test(line)) {
      inPaths = true;
      continue;
    }
    if (!inPaths) continue;
    // A non-indented key ends the `paths:` block.
    if (/^[A-Za-z]/.test(line)) break;

    const pathMatch = /^ {2}(\/\S*):\s*$/.exec(line);
    if (pathMatch) {
      currentPath = pathMatch[1]!;
      continue;
    }
    const methodMatch = /^ {4}(get|post|put|patch|delete):/.exec(line);
    if (methodMatch && currentPath) {
      operations.add(`${methodMatch[1]!.toUpperCase()} ${currentPath}`);
    }
  }
  return operations;
}

/** `/issues/{issueId}` (OpenAPI) and `/issues/:issueId` (Fastify) are the same route. */
function normalise(path: string): string {
  return path.replace(/\{(\w+)\}/g, ':$1');
}

const config = loadConfig({
  DATABASE_URL: 'postgres://nobody:nothing@127.0.0.1:1/nowhere',
  REDIS_URL: 'redis://127.0.0.1:1',
  BLOB_STORE_ROOT: '/nonexistent-path-for-test',
});
const deps = buildDependencies(config);
after(() => closeDependencies(deps));

/**
 * Collects what the server genuinely serves, via Fastify's own `onRoute`
 * hook — not a grep over source files (which would match a commented-out
 * handler) and not `printRoutes`, whose tree output prints child routes as
 * bare suffixes and so cannot be read back into full paths reliably.
 */
async function registeredRoutes(): Promise<Set<string>> {
  const app = buildServer(deps);
  const routes = new Set<string>();
  app.addHook('onRoute', (route) => {
    const methods = Array.isArray(route.method) ? route.method : [route.method];
    for (const method of methods) routes.add(`${method} ${route.url}`);
  });
  await app.ready();
  await app.close();
  return routes;
}

test('every operation in openapi.yaml has a registered route (P1-01/GATE 2)', async () => {
  const registered = await registeredRoutes();

  const declared = declaredOperations(readFileSync(specPath(), 'utf8'));
  assert.ok(
    declared.size > 100,
    `expected the contract to declare many operations, saw ${declared.size}`,
  );

  const missing = [...declared]
    .map((operation) => {
      const [method, path] = operation.split(' ') as [string, string];
      // Every documented path is mounted under the `/v1` prefix (the
      // contract's own `servers: - url: /v1`); /healthz, /readyz and
      // /metrics are deliberately outside it and are not in `paths:`.
      return `${method} /v1${normalise(path)}`;
    })
    .filter((operation) => !registered.has(operation));

  assert.deepEqual(
    missing,
    [],
    `The contract declares ${missing.length} operation(s) with no route behind them:\n  ${missing.join('\n  ')}`,
  );
});

test('the operational endpoints stay outside the versioned contract (OPS-02/OPS-03)', async () => {
  const registered = await registeredRoutes();
  for (const path of ['/healthz', '/readyz', '/metrics']) {
    assert.ok(registered.has(`GET ${path}`), `${path} should be registered unprefixed`);
    assert.ok(!registered.has(`GET /v1${path}`), `${path} should not be mounted under /v1`);
  }
});
