import createFetchClient, { type ClientOptions } from 'openapi-fetch';
import type { paths } from './generated/types.js';

/**
 * P1-02. The only place a request is issued from apps/web or apps/api's own
 * internal calls to itself (there are none — this is for the browser and for
 * contract tests) — every method call is checked against `paths` at compile
 * time, so an endpoint rename or a changed parameter is a type error here,
 * not a runtime surprise discovered by a user.
 */
export function createXenitexClient(options: ClientOptions) {
  return createFetchClient<paths>(options);
}

export type XenitexClient = ReturnType<typeof createXenitexClient>;
